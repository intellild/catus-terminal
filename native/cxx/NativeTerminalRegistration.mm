#include "NativeFrameHost.h"
#include "NativeVSyncMonitorMacOS.h"
#include "catus-native/src/frame_clock.rs.h"

#include <lynx/registration.h>
namespace {
struct TerminalExtension {
  std::shared_ptr<catus::NativeFrameHost> host;
  std::shared_ptr<lynx::pub::LynxVSyncMonitor> vsync;
};

TerminalExtension& Extension(lynx_extension_module_t* module) {
  return *static_cast<TerminalExtension*>(lynx_extension_module_get_user_data(module));
}

lynx_extension_module_t* CreateTerminalExtension(void*) {
  auto* extension = new TerminalExtension;
  auto* module = lynx_extension_module_create_with_finalizer(extension,
      [](lynx_extension_module_t*, void* data) { delete static_cast<TerminalExtension*>(data); });
  extension->host = std::make_shared<catus::NativeFrameHost>(module);
  lynx_extension_module_bind_lynx_view_create(module,
      [](lynx_extension_module_t* module, lynx_view_t* view) {
        Extension(module).vsync = catus::InstallVSyncMonitor(view);
        Extension(module).host->RegisterOnUI();
        lynx_view_register_native_view(view, "native-terminal", catus::CreateNativeTerminalView,
            Extension(module).host.get());
      });
  // Binding runtime-init also allows Lynx to install the BTS task runner.
  lynx_extension_module_bind_runtime_init(module, [](lynx_extension_module_t*) {});
  lynx_extension_module_bind_runtime_attach(module,
      [](lynx_extension_module_t* module, napi_env, lynx_vsync_observer_t* observer) {
        Extension(module).host->clock().attach_runtime(reinterpret_cast<uintptr_t>(observer));
      });
  lynx_extension_module_bind_runtime_detach(module,
      [](lynx_extension_module_t* module) { Extension(module).host->clock().detach_runtime(); });
  lynx_extension_module_bind_enter_foreground(module,
      [](lynx_extension_module_t* module) { Extension(module).host->clock().set_foreground(true); });
  lynx_extension_module_bind_enter_background(module,
      [](lynx_extension_module_t* module) { Extension(module).host->clock().set_foreground(false); });
  lynx_extension_module_bind_lynx_view_destroy(module,
      [](lynx_extension_module_t* module) {
        Extension(module).host->RemoveFromUI();
        catus::StopVSyncMonitor(Extension(module).vsync);
      });
  lynx_extension_module_bind_on_destroy(module,
      [](lynx_extension_module_t* module) { Extension(module).host->clock().destroy(); });
  return module;
}

LYNX_REGISTRATION_CONSTRUCTOR(RegisterTerminalExtension) {
  lynx_env_register_extension_module("CatusNativeTerminalElement", CreateTerminalExtension, false, nullptr);
}
}  // namespace
