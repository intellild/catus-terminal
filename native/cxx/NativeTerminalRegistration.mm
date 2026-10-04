#include "NativeFrameCallbacks.h"
#include "NativeVSyncMonitorMacOS.h"
#include "catus-native/src/frame_callbacks.rs.h"

#include <lynx/registration.h>
namespace {
struct TerminalExtension {
  std::shared_ptr<catus::NativeFrameCallbacks> frames = std::make_shared<catus::NativeFrameCallbacks>();
  std::shared_ptr<catus::NativeVSyncSource> vsync;
};

TerminalExtension& Extension(lynx_extension_module_t* module) {
  return *static_cast<TerminalExtension*>(lynx_extension_module_get_user_data(module));
}

lynx_extension_module_t* CreateTerminalExtension(void*) {
  auto* extension = new TerminalExtension;
  auto* module = lynx_extension_module_create_with_finalizer(extension,
      [](lynx_extension_module_t*, void* data) { delete static_cast<TerminalExtension*>(data); });
  lynx_extension_module_bind_lynx_view_create(module,
      [](lynx_extension_module_t* module, lynx_view_t* view) {
        auto frames = std::weak_ptr(Extension(module).frames);
        Extension(module).vsync = catus::StartVSync(view, [frames](int64_t deadline) {
          if (auto owner = frames.lock()) owner->callbacks().on_vsync(deadline);
        });
        lynx_view_register_native_view(view, "native-terminal", catus::CreateNativeTerminalView,
            Extension(module).frames.get());
      });
  lynx_extension_module_bind_enter_foreground(module,
      [](lynx_extension_module_t* module) { Extension(module).frames->callbacks().set_foreground(true); });
  lynx_extension_module_bind_enter_background(module,
      [](lynx_extension_module_t* module) { Extension(module).frames->callbacks().set_foreground(false); });
  lynx_extension_module_bind_lynx_view_destroy(module,
      [](lynx_extension_module_t* module) {
        Extension(module).frames->callbacks().destroy();
        Extension(module).vsync->Stop();
      });
  return module;
}

LYNX_REGISTRATION_CONSTRUCTOR(RegisterTerminalExtension) {
  lynx_env_register_extension_module("CatusNativeTerminalElement", CreateTerminalExtension, false, nullptr);
}
}  // namespace
