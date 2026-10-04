#pragma once

#include "rust/cxx.h"

#include <functional>
#include <memory>
#include <vector>

struct lynx_extension_module_t;
typedef struct lynx_native_view_ lynx_native_view_t;

namespace catus {
struct FrameClock;
struct FrameListener;
struct FrameTask;

// Only UI presentation lives in C++; Rust owns subscriptions and frame scheduling.
struct NativeFrameTarget {
  explicit NativeFrameTarget(rust::Box<FrameListener> listener);
  ~NativeFrameTarget();
  rust::Box<FrameListener> listener;
  std::function<void()> render;
};

class NativeFrameHost : public std::enable_shared_from_this<NativeFrameHost> {
 public:
  explicit NativeFrameHost(lynx_extension_module_t* module);
  ~NativeFrameHost();
  FrameClock& clock();
  void RegisterOnUI();
  void RemoveFromUI();
  std::shared_ptr<NativeFrameTarget> RegisterListener();
  void RenderFrame();

 private:
  rust::Box<FrameClock> clock_;
  std::vector<std::weak_ptr<NativeFrameTarget>> targets_;
};

lynx_native_view_t* CreateNativeTerminalView(void* opaque);
void post_frame_task(uintptr_t module, rust::Box<FrameTask> task);
void request_native_frame(uintptr_t observer, rust::Box<FrameTask> task);
void post_frame_to_ui(rust::Box<FrameTask> task);
}  // namespace catus
