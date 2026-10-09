#include <lynx/registration.h>
#include <lynx_extension_module.h>

#include "common/NativeFrameCallbacks.h"
#include "platform/RustBridge.h"

namespace {
class TerminalExtension final : public lynx::pub::LynxExtensionModule {
 public:
  void OnLynxViewCreate(lynx_view_t* view) override {
    frames_->view = view;
    lynx_view_register_native_view(view, "native-terminal", catus::CreateNativeTerminalView,
                                   frames_.get());
  }
  void OnLynxViewDestroy() override { frames_->callbacks().destroy(); }
  void OnEnterForeground() override { frames_->callbacks().set_foreground(true); }
  void OnEnterBackground() override { frames_->callbacks().set_foreground(false); }

 private:
  std::shared_ptr<catus::NativeFrameCallbacks> frames_ =
      std::make_shared<catus::NativeFrameCallbacks>();
};

lynx_extension_module_t* CreateTerminalExtension(void*) {
  auto* extension = new TerminalExtension;
  auto* module = lynx_extension_module_create_with_finalizer(
      static_cast<lynx::pub::LynxExtensionModule*>(extension),
      [](lynx_extension_module_t*, void* data) {
        delete static_cast<lynx::pub::LynxExtensionModule*>(data);
      });
  extension->SetCModule(module);
  return module;
}

LYNX_REGISTRATION_CONSTRUCTOR(RegisterTerminalExtension) {
  lynx_env_register_extension_module("CatusNativeTerminalElement", CreateTerminalExtension, false,
                                     nullptr);
}
}  // namespace
