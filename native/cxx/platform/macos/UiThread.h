#pragma once

#include <pthread.h>

#include <chrono>
#include <cstdint>

namespace catus {
inline int64_t monotonic_now_ns() {
  return std::chrono::duration_cast<std::chrono::nanoseconds>(
             std::chrono::steady_clock::now().time_since_epoch())
      .count();
}
inline bool IsUiThread() { return pthread_main_np() != 0; }
}  // namespace catus
