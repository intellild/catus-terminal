#include "common/NativeFrameCallbacks.h"

#include "platform/RustBridge.h"

namespace catus {
NativeFrameCallbacks::NativeFrameCallbacks(lynx_view_t* view, rust::Box<FrameCallbacks> callbacks)
    : view(view), callbacks_(std::move(callbacks)) {}
NativeFrameCallbacks::~NativeFrameCallbacks() = default;
const FrameCallbacks& NativeFrameCallbacks::callbacks() const { return *callbacks_; }
std::shared_ptr<NativeFrameCallbacks> create_native_frame_callbacks(
    lynx_view_t* view, rust::Box<FrameCallbacks> callbacks) {
  return std::make_shared<NativeFrameCallbacks>(view, std::move(callbacks));
}
}  // namespace catus
