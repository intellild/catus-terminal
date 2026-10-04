#include "NativeVSyncMonitorMacOS.h"
#include "NativeFrameCallbacks.h"

#import <AppKit/AppKit.h>
#import <QuartzCore/QuartzCore.h>

#include <cassert>

@interface CatusVSyncSource : NSObject
- (instancetype)initWithScreen:(NSScreen*)screen callback:(std::function<void(int64_t)>)callback;
- (void)invalidate;
@end

@implementation CatusVSyncSource {
  CADisplayLink* link_;
  NSTimer* timer_;
  std::function<void(int64_t)> callback_;
}
- (instancetype)initWithScreen:(NSScreen*)screen callback:(std::function<void(int64_t)>)callback {
  if ((self = [super init])) {
    callback_ = std::move(callback);
    if (@available(macOS 14.0, *)) {
      link_ = [screen displayLinkWithTarget:self selector:@selector(onFrame:)];
      [link_ addToRunLoop:[NSRunLoop mainRunLoop] forMode:NSRunLoopCommonModes];
    } else {
      // Preserve a UI-thread timer fallback for older macOS versions.
      timer_ = [NSTimer timerWithTimeInterval:1.0 / 60 target:self
          selector:@selector(onTimer:) userInfo:nil repeats:YES];
      [[NSRunLoop mainRunLoop] addTimer:timer_ forMode:NSRunLoopCommonModes];
    }
  }
  return self;
}
- (void)invalidate {
  [link_ invalidate];
  [timer_ invalidate];
  link_ = nil;
  timer_ = nil;
  callback_ = nullptr;
}
- (void)onFrame:(CADisplayLink*)link {
  if (!callback_) return;
  // Map Core Animation's target time onto the same monotonic clock Rust uses.
  const auto deadline = catus::monotonic_now_ns() +
      static_cast<int64_t>((link.targetTimestamp - CACurrentMediaTime()) * 1e9);
  callback_(deadline);
}
- (void)onTimer:(NSTimer*)timer {
  (void)timer;
  if (callback_) callback_(catus::monotonic_now_ns() + 16666667);
}
@end

namespace catus {
namespace {
class MacVSyncSource final : public NativeVSyncSource {
 public:
  MacVSyncSource(NSScreen* screen, std::function<void(int64_t)> callback) {
    source_ = [[CatusVSyncSource alloc] initWithScreen:screen callback:std::move(callback)];
  }
  ~MacVSyncSource() override {
    // Extension finalization is on BTS; ordinary stop is already done on UI.
    auto source = source_;
    if ([NSThread isMainThread]) [source invalidate];
    else if (source) dispatch_async(dispatch_get_main_queue(), ^{ [source invalidate]; });
  }
  void Stop() override {
    assert([NSThread isMainThread]);
    [source_ invalidate];
    source_ = nil;
  }
 private:
  CatusVSyncSource* source_ = nil;
};
}

std::shared_ptr<NativeVSyncSource> StartVSync(
    lynx_view_t* view, std::function<void(int64_t)> callback) {
  assert([NSThread isMainThread]);
  id parent = (__bridge id)lynx_view_get_native_window(view);
  NSScreen* screen = nil;
  if ([parent isKindOfClass:[NSView class]]) screen = [(NSView*)parent window].screen;
  else if ([parent isKindOfClass:[NSWindow class]]) screen = [(NSWindow*)parent screen];
  return std::make_shared<MacVSyncSource>(screen ?: [NSScreen mainScreen], std::move(callback));
}
}
