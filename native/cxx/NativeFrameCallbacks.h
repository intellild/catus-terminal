#pragma once

#include "rust/cxx.h"
#include <chrono>
#include <functional>
#include <memory>
#include <mutex>
#include <cassert>
#include <pthread.h>
#include <dispatch/dispatch.h>

typedef struct lynx_native_view_ lynx_native_view_t;

namespace catus {
struct FrameCallbacks;
struct FrameRegistration;

// Rust retains this callback target; the view clears render before destruction.
struct NativeFrameTarget {
  void SetRender(std::function<void(int64_t)> render) {
    std::lock_guard lock(mutex_);
    render_ = std::move(render);
  }
  void Render(int64_t deadline) const {
    assert(pthread_main_np());
    std::lock_guard lock(mutex_);
    if (render_) render_(deadline);
  }
 private:
  mutable std::mutex mutex_;
  std::function<void(int64_t)> render_;
};

inline int64_t monotonic_now_ns() {
  return std::chrono::duration_cast<std::chrono::nanoseconds>(
      std::chrono::steady_clock::now().time_since_epoch()).count();
}
inline void render_target(const NativeFrameTarget& target, int64_t deadline) {
  target.Render(deadline);
}

// The only platform adapter: deliver a signal to UI, then let Rust dispatch.
void dispatch_frame_callbacks(int64_t deadline) noexcept;
inline void post_frame_to_ui(int64_t deadline) {
  dispatch_async_f(dispatch_get_main_queue(), new int64_t(deadline), [](void* context) {
    std::unique_ptr<int64_t> deadline(static_cast<int64_t*>(context));
    dispatch_frame_callbacks(*deadline);
  });
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
