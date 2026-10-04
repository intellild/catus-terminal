#include "NativeVSyncMonitorMacOS.h"

#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>

#include <chrono>
#include <vector>

@interface CatusVSyncSource : NSObject
- (instancetype)initWithScreen:(NSScreen*)screen callback:(std::function<void(int64_t, int64_t)>)callback;
- (void)request;
- (void)invalidate;
@end

@implementation CatusVSyncSource {
  CADisplayLink* link_;
  std::function<void(int64_t, int64_t)> callback_;
}
- (instancetype)initWithScreen:(NSScreen*)screen callback:(std::function<void(int64_t, int64_t)>)callback {
  if ((self = [super init])) {
    callback_ = std::move(callback);
    if (@available(macOS 14.0, *)) {
      link_ = [screen displayLinkWithTarget:self selector:@selector(onFrame:)];
      link_.paused = YES;
      [link_ addToRunLoop:[NSRunLoop mainRunLoop] forMode:NSRunLoopCommonModes];
    }
  }
  return self;
}
- (void)request { link_.paused = NO; }
- (void)invalidate {
  [link_ invalidate];
  link_ = nil;
  callback_ = nullptr;
}
- (void)onFrame:(CADisplayLink*)link {
  link.paused = YES;
  if (!callback_) return;
  const auto now = std::chrono::duration_cast<std::chrono::nanoseconds>(
      std::chrono::steady_clock::now().time_since_epoch()).count();
  const int64_t start = now - static_cast<int64_t>((CACurrentMediaTime() - link.timestamp) * 1e9);
  const int64_t end = start + static_cast<int64_t>((link.targetTimestamp - link.timestamp) * 1e9);
  callback_(start, end);
}
@end

namespace catus {
namespace {
class MacVSyncMonitor final : public lynx::pub::LynxVSyncMonitor {
 public:
  explicit MacVSyncMonitor(NSScreen* screen) : LynxVSyncMonitor(nullptr), screen_(screen) {}
  ~MacVSyncMonitor() override {
    auto source = source_;
    dispatch_async(dispatch_get_main_queue(), ^{ [source invalidate]; });
  }
  void RequestVSync(std::function<void(int64_t, int64_t)> callback) override {
    auto weak = weak_from_this();
    dispatch_async(dispatch_get_main_queue(), ^{
      if (auto base = weak.lock()) {
        auto* monitor = static_cast<MacVSyncMonitor*>(base.get());
        if (monitor->stopped_) return;
        monitor->callbacks_.emplace_back(callback);
        if (!monitor->source_) {
          monitor->source_ = [[CatusVSyncSource alloc] initWithScreen:monitor->screen_
              callback:[weak](int64_t start, int64_t end) {
                if (auto base = weak.lock()) {
                  auto* monitor = static_cast<MacVSyncMonitor*>(base.get());
                  auto callbacks = std::move(monitor->callbacks_);
                  monitor->callbacks_.clear();
                  for (auto& callback : callbacks) callback(start, end);
                }
              }];
        }
        [monitor->source_ request];
      }
    });
  }
  void Stop() {
    stopped_ = true;
    [source_ invalidate];
    source_ = nil;
    callbacks_.clear();
  }

 private:
  NSScreen* screen_;
  CatusVSyncSource* source_ = nil;
  std::vector<std::function<void(int64_t, int64_t)>> callbacks_;
  bool stopped_ = false; // UI thread only.
};
}

std::shared_ptr<lynx::pub::LynxVSyncMonitor> InstallVSyncMonitor(lynx_view_t* view) {
  if (@available(macOS 14.0, *)) {
    id parent = (__bridge id)lynx_view_get_native_window(view);
    NSScreen* screen = nil;
    if ([parent isKindOfClass:[NSView class]]) screen = [(NSView*)parent window].screen;
    else if ([parent isKindOfClass:[NSWindow class]]) screen = [(NSWindow*)parent screen];
    auto monitor = std::make_shared<MacVSyncMonitor>(screen ?: [NSScreen mainScreen]);
    monitor->InitIfNeed();
    lynx_view_set_custom_vsync_monitor(view, monitor->GetCMonitor());
    return monitor;
  }
  return nullptr; // Older SDK platforms use Lynx's timer-based monitor.
}

void StopVSyncMonitor(const std::shared_ptr<lynx::pub::LynxVSyncMonitor>& monitor) {
  if (monitor) static_cast<MacVSyncMonitor*>(monitor.get())->Stop();
}
}
