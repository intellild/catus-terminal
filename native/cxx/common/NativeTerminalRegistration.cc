#include <lynx/registration.h>

#include "common/NativeFrameCallbacks.h"
#include "platform/RustBridge.h"

namespace {
struct TerminalExtension {
  std::shared_ptr<catus::NativeFrameCallbacks> frames =
      std::make_shared<catus::NativeFrameCallbacks>();
};

TerminalExtension& Extension(lynx_extension_module_t* module) {
  return *static_cast<TerminalExtension*>(lynx_extension_module_get_user_data(module));
}

lynx_extension_module_t* CreateTerminalExtension(void*) {
  auto* extension = new TerminalExtension;
  auto* module = lynx_extension_module_create_with_finalizer(
      extension,
      [](lynx_extension_module_t*, void* data) { delete static_cast<TerminalExtension*>(data); });
  lynx_extension_module_bind_lynx_view_create(
      module, [](lynx_extension_module_t* module, lynx_view_t* view) {
        Extension(module).frames->view = view;
        lynx_view_register_native_view(view, "native-terminal", catus::CreateNativeTerminalView,
                                       Extension(module).frames.get());
      });
  lynx_extension_module_bind_enter_foreground(module, [](lynx_extension_module_t* module) {
    Extension(module).frames->callbacks().set_foreground(true);
  });
  lynx_extension_module_bind_enter_background(module, [](lynx_extension_module_t* module) {
    Extension(module).frames->callbacks().set_foreground(false);
  });
  lynx_extension_module_bind_lynx_view_destroy(module, [](lynx_extension_module_t* module) {
    Extension(module).frames->callbacks().destroy();
  });
  return module;
}

LYNX_REGISTRATION_CONSTRUCTOR(RegisterTerminalExtension) {
  lynx_env_register_extension_module("CatusNativeTerminalElement", CreateTerminalExtension, false,
                                     nullptr);
}
}  // namespace
