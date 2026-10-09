#include "common/NativeTerminalView.h"

namespace catus {
namespace {
// These are the only host callbacks Rust needs. AppKit objects and events stay
// in Rust; C++ translates Lynx's public C API into pointer-sized bridge values.
extern "C" void RequestTerminalFocus(uintptr_t view) {
  lynx_native_view_request_focus(reinterpret_cast<lynx_native_view_t*>(view));
}
extern "C" void RegisterTerminalIME(uintptr_t view, uintptr_t handler, uintptr_t opaque) {
  lynx_view_register_ime_handler(reinterpret_cast<lynx_view_t*>(view),
      reinterpret_cast<void*>(handler), reinterpret_cast<void*>(opaque));
}

class NativeTerminalMacOSView final : public NativeTerminalView {
 public:
  explicit NativeTerminalMacOSView(std::shared_ptr<NativeFrameCallbacks> host)
      : NativeTerminalView(host), platform_(create_mac_terminal_view(NativeViewHost{
          reinterpret_cast<uintptr_t>(lynx_view_get_native_window(host->view)),
          reinterpret_cast<uintptr_t>(host->view),
          reinterpret_cast<uintptr_t>(native_view()),
          reinterpret_cast<uintptr_t>(RequestTerminalFocus),
          reinterpret_cast<uintptr_t>(RegisterTerminalIME)})) {}

  bool IsSurfaceEnabled() override { return platform_->uses_osr(); }
  void OnAttach() override { platform_->attach(); NativeTerminalView::OnAttach(); }
  void OnDetach() override { platform_->detach(); NativeTerminalView::OnDetach(); }
  void OnDestroy() override { platform_->destroy(); NativeTerminalView::OnDestroy(); }
  void OnPropertiesChanged(const LynxValue& attrs, const LynxValue& events) override {
    if (attrs.HasProperty("use-osr")) {
      const auto value = attrs.GetProperty("use-osr");
      platform_->set_osr(value.Type() == lynx_value_bool && value.Bool());
    }
    NativeTerminalView::OnPropertiesChanged(attrs, events);
  }
  void OnLayoutChanged(float left, float top, float width, float height, float ratio) override {
    platform_->layout(left, top, width, height, ratio);
    NativeTerminalView::OnLayoutChanged(left, top, width, height, ratio);
  }
  void OnFocusChanged(bool focused, bool leaf) override {
    if (focused && leaf) platform_->focus(); else platform_->blur();
  }
  void OnMotionEvent(native_view_motion_event_t* event) override {
    if (event->type == kNativeEventDown) Focus();
  }
 protected:
  void Focus() override { RequestFocus(); platform_->focus(); }
  void BindTerminal(const TerminalHandle& terminal) override { platform_->bind_terminal(terminal); }
  void UnbindTerminal() override { platform_->clear_terminal(); }
  bool PresentFrame() override { return platform_->uses_osr() ? NativeTerminalView::PresentFrame() : true; }
  bool RenderSurface(TerminalHandle&, const Viewport& viewport, int64_t deadline) override {
    if (!platform_->uses_osr()) return platform_->render_native(deadline);
    auto* surface = AcquireSurface(viewport.width, viewport.height);
    if (!surface) throw std::runtime_error("Lynx back buffer is unavailable");
    return platform_->render_osr(*reinterpret_cast<IOSurface*>(surface), deadline);
  }
 private:
  rust::Box<MacTerminalView> platform_;
};
}  // namespace

lynx_native_view_t* CreateNativeTerminalView(void* opaque) {
  auto host = static_cast<NativeFrameCallbacks*>(opaque)->shared_from_this();
  return (new NativeTerminalMacOSView(std::move(host)))->native_view();
}
}  // namespace catus
