#include "NativeFrameHost.h"
#include "catus-native/src/frame_clock.rs.h"

#include <lynx_extension_module.h>
#import <Foundation/Foundation.h>

#include <algorithm>
#include <unordered_map>

namespace catus {
namespace {
// Accessed only on the macOS UI thread. Queued frames never retain native views.
std::unordered_map<uint64_t, std::weak_ptr<NativeFrameHost>> hosts;
}

NativeFrameTarget::NativeFrameTarget(rust::Box<FrameListener> listener)
    : listener(std::move(listener)) {}
NativeFrameTarget::~NativeFrameTarget() = default;

NativeFrameHost::NativeFrameHost(lynx_extension_module_t* module)
    : clock_(create_frame_clock(reinterpret_cast<uintptr_t>(module))) {}
NativeFrameHost::~NativeFrameHost() = default;

FrameClock& NativeFrameHost::clock() { return *clock_; }

void NativeFrameHost::RegisterOnUI() { hosts[clock_->id()] = weak_from_this(); }
void NativeFrameHost::RemoveFromUI() {
  clock_->set_foreground(false);
  hosts.erase(clock_->id());
}

std::shared_ptr<NativeFrameTarget> NativeFrameHost::RegisterListener() {
  auto target = std::make_shared<NativeFrameTarget>(clock_->register_frame_listener());
  targets_.emplace_back(target);
  return target;
}

void NativeFrameHost::RenderFrame() {
  targets_.erase(std::remove_if(targets_.begin(), targets_.end(),
      [](const auto& target) { return target.expired(); }), targets_.end());
  for (const auto& weak : targets_) {
    if (auto target = weak.lock(); target && target->listener->take_frame()) target->render();
  }
}

void post_frame_task(uintptr_t module, rust::Box<FrameTask> task) {
  auto* holder = new rust::Box<FrameTask>(std::move(task));
  lynx_extension_module_post_task_to_runtime(reinterpret_cast<lynx_extension_module_t*>(module),
      [](void* data) {
        std::unique_ptr<rust::Box<FrameTask>> holder(static_cast<rust::Box<FrameTask>*>(data));
        frame_task_request(std::move(*holder));
      }, holder);
}

void request_native_frame(uintptr_t observer, rust::Box<FrameTask> task) {
  auto holder = std::make_shared<rust::Box<FrameTask>>(std::move(task));
  lynx::pub::VSyncObserver vsync(reinterpret_cast<lynx_vsync_observer_t*>(observer));
  // Unique live allocation avoids collisions with JS RAF and old runtime callbacks.
  vsync.RequestAnimationFrame(reinterpret_cast<uintptr_t>(holder.get()),
      [holder](int64_t start, int64_t end) {
        frame_task_vsync(std::move(*holder), start, end);
      });
}

void post_frame_to_ui(rust::Box<FrameTask> task) {
  auto holder = std::make_shared<rust::Box<FrameTask>>(std::move(task));
  dispatch_async(dispatch_get_main_queue(), ^{
    @autoreleasepool {
      auto& task = **holder;
      if (task.is_current()) {
        const auto found = hosts.find(task.clock_id());
        if (found != hosts.end()) {
          if (auto host = found->second.lock()) host->RenderFrame();
        }
      }
      frame_task_complete(std::move(*holder));
    }
  });
}
}  // namespace catus
