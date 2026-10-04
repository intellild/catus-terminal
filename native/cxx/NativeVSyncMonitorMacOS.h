#pragma once
#include <capi/lynx_view_capi.h>
#include <functional>
#include <memory>

namespace catus {
class NativeVSyncSource {
 public:
  virtual ~NativeVSyncSource() = default;
  virtual void Stop() = 0;
};
// Creates a continuous display link on the UI run loop. Callbacks run inline.
std::shared_ptr<NativeVSyncSource> StartVSync(
    lynx_view_t* view, std::function<void(int64_t)> callback);
}
