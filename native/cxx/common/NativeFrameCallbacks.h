#pragma once

#include <cassert>
#include <chrono>
#include <functional>
#include <memory>
#include <mutex>

#include "common/NativeTerminalFactory.h"
#include "platform/UiThread.h"
#include "rust/cxx.h"

typedef struct lynx_view_t lynx_view_t;

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
    assert(IsUiThread());
    std::lock_guard lock(mutex_);
    if (render_) render_(deadline);
  }

 private:
  mutable std::mutex mutex_;
  std::function<void(int64_t)> render_;
};

inline int64_t monotonic_now_ns() {
  return std::chrono::duration_cast<std::chrono::nanoseconds>(
             std::chrono::steady_clock::now().time_since_epoch())
      .count();
}
inline void render_target(const NativeFrameTarget& target, int64_t deadline) {
  target.Render(deadline);
}

class NativeFrameCallbacks : public std::enable_shared_from_this<NativeFrameCallbacks> {
 public:
  NativeFrameCallbacks(lynx_view_t* view, rust::Box<FrameCallbacks> callbacks);
  ~NativeFrameCallbacks();
  const FrameCallbacks& callbacks() const;
  lynx_view_t* const view;

 private:
  rust::Box<FrameCallbacks> callbacks_;
};

std::shared_ptr<NativeFrameCallbacks> create_native_frame_callbacks(
    lynx_view_t* view, rust::Box<FrameCallbacks> callbacks);
}  // namespace catus
