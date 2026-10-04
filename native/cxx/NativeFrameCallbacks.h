#pragma once

#include "rust/cxx.h"
#include <chrono>
#include <functional>
#include <memory>

typedef struct lynx_native_view_ lynx_native_view_t;

namespace catus {
struct FrameCallbacks;
struct FrameRegistration;

// Rust retains this callback target; the view clears render before destruction.
struct NativeFrameTarget {
  std::function<void(int64_t)> render;
};

inline int64_t monotonic_now_ns() {
  return std::chrono::duration_cast<std::chrono::nanoseconds>(
      std::chrono::steady_clock::now().time_since_epoch()).count();
}
inline void render_target(const NativeFrameTarget& target, int64_t deadline) {
  if (target.render) target.render(deadline);
}

class NativeFrameCallbacks : public std::enable_shared_from_this<NativeFrameCallbacks> {
 public:
  NativeFrameCallbacks();
  ~NativeFrameCallbacks();
  FrameCallbacks& callbacks();
 private:
  rust::Box<FrameCallbacks> callbacks_;
};

lynx_native_view_t* CreateNativeTerminalView(void* opaque);
}  // namespace catus
