#pragma once

#include <cstdint>
#include <memory>
#include <pthread.h>
#include <dispatch/dispatch.h>

namespace catus {
inline bool IsUiThread() { return pthread_main_np() != 0; }
void dispatch_frame_callbacks(int64_t deadline) noexcept;
inline void post_frame_to_ui(int64_t deadline) {
  dispatch_async_f(dispatch_get_main_queue(), new int64_t(deadline), [](void* context) {
    std::unique_ptr<int64_t> deadline(static_cast<int64_t*>(context));
    dispatch_frame_callbacks(*deadline);
  });
}
}  // namespace catus
