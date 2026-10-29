#pragma once

#include <dispatch/dispatch.h>
#include <pthread.h>

#include <chrono>
#include <cstddef>
#include <cstdint>

namespace catus {
inline int64_t monotonic_now_ns() {
  return std::chrono::duration_cast<std::chrono::nanoseconds>(
             std::chrono::steady_clock::now().time_since_epoch())
      .count();
}
inline bool IsUiThread() { return pthread_main_np() != 0; }
void dispatch_ui_task(size_t context) noexcept;
inline void post_task_to_ui(size_t context) {
  dispatch_async_f(dispatch_get_main_queue(), reinterpret_cast<void*>(context),
                   [](void* context) { dispatch_ui_task(reinterpret_cast<size_t>(context)); });
}
}  // namespace catus
