#include "NativeFrameCallbacks.h"
#include "catus-native/src/platform/macos/frame.rs.h"

namespace catus {
NativeFrameCallbacks::NativeFrameCallbacks() : callbacks_(create_frame_callbacks()) {}
NativeFrameCallbacks::~NativeFrameCallbacks() = default;
FrameCallbacks& NativeFrameCallbacks::callbacks() { return *callbacks_; }
}  // namespace catus
