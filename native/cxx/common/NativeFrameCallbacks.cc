#include "common/NativeFrameCallbacks.h"

#include "platform/RustBridge.h"

namespace catus {
NativeFrameCallbacks::NativeFrameCallbacks() : callbacks_(create_frame_callbacks()) {}
NativeFrameCallbacks::~NativeFrameCallbacks() = default;
FrameCallbacks& NativeFrameCallbacks::callbacks() { return *callbacks_; }
}  // namespace catus
