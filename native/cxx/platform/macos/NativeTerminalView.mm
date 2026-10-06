#include "common/NativeTerminalView.h"

namespace catus {
namespace {
class NativeTerminalMacOSView final : public NativeTerminalView {
 public:
  using NativeTerminalView::NativeTerminalView;

 protected:
  bool RenderSurface(TerminalHandle& terminal, const Viewport& viewport,
                     int64_t deadline) override {
    // Lynx owns the IOSurface. Rust finishes GPU writes before returning it.
    auto* surface = AcquireSurface(viewport.width, viewport.height);
    if (surface == nullptr) throw std::runtime_error("Lynx back buffer is unavailable");
    return terminal.render_surface(reinterpret_cast<uintptr_t>(surface), deadline);
  }
};
}  // namespace

lynx_native_view_t* CreateNativeTerminalView(void* opaque) {
  auto host = static_cast<NativeFrameCallbacks*>(opaque)->shared_from_this();
  return (new NativeTerminalMacOSView(std::move(host)))->native_view();
}
}  // namespace catus
