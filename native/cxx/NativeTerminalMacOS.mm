#include <lynx/registration.h>
#include <lynx_native_view.h>
#include "catus-native/src/terminal_view.rs.h"
#include "rust/cxx.h"

#import <Metal/Metal.h>
#import <IOSurface/IOSurface.h>

#include <cmath>
#include <mutex>
#include <optional>
#include <string>
#include <limits>
#include <stdexcept>

namespace {
using lynx::pub::LynxValue;

class NativeTerminalView : public lynx::pub::LynxNativeView {
 public:
  bool IsSurfaceEnabled() override { return true; }

  void OnAttach() override {
    std::lock_guard lock(mutex_);
    attached_ = true;
    if (terminal_) (*terminal_)->invalidate_frame();
    Render();
  }
  void OnDetach() override {
    std::lock_guard lock(mutex_);
    attached_ = false;
  }
  void OnDestroy() override {
    std::lock_guard lock(mutex_);
    terminal_.reset();
  }
  void OnLayoutChanged(float left, float top, float width, float height,
                       float pixel_ratio) override {
    (void)left;
    (void)top;
    std::lock_guard lock(mutex_);
    if (!std::isfinite(width) || !std::isfinite(height) ||
        !std::isfinite(pixel_ratio) || pixel_ratio <= 0 ||
        width <= 0 || height <= 0 || width * pixel_ratio > 8192 ||
        height * pixel_ratio > 8192) {
      viewport_.width = viewport_.height = 0;
      error_ = "Terminal layout is zero or exceeds the texture size limit";
      return;
    }
    viewport_.width = static_cast<uint32_t>(std::ceil(width * pixel_ratio));
    viewport_.height = static_cast<uint32_t>(std::ceil(height * pixel_ratio));
    viewport_.pixel_ratio = pixel_ratio;
    try {
      if (terminal_) (*terminal_)->resize_viewport(viewport_);
      Render();
    } catch (const rust::Error& error) { error_ = error.what(); }
  }
  void OnPropertiesChanged(const LynxValue& attrs, const LynxValue& events) override {
    (void)events;
    if (!attrs.HasProperty("terminal-id")) return;
    auto value = attrs.GetProperty("terminal-id");
    const auto type = value.Type();
    if (type != lynx_value_double && type != lynx_value_int32 && type != lynx_value_int64) return;
    const double number = value.Number();
    if (!std::isfinite(number) || number <= 0 ||
        number > std::numeric_limits<uint32_t>::max() || std::floor(number) != number) return;
    std::lock_guard lock(mutex_);
    const auto id = static_cast<uint32_t>(number);
    if (id == terminal_id_) return;
    try {
      auto terminal = catus::acquire_terminal(id);
      if (viewport_.width != 0 && viewport_.height != 0) terminal->resize_viewport(viewport_);
      terminal_.emplace(std::move(terminal));
      terminal_id_ = id;
      if (terminal_) (*terminal_)->invalidate_frame();
      Render();
    } catch (const rust::Error& error) { error_ = error.what(); }
  }
  void OnMethodInvoked(const char* method, const LynxValue& params,
      std::function<void(int, LynxValue&&)> callback) override {
    std::unique_lock lock(mutex_);
    const std::string name = method ? method : "";
    if (name == "focus") {
      lock.unlock();
      RequestFocus();
      callback(kSuccess, LynxValue(true));
      return;
    }
    if (name == "write" || name == "key") {
      try {
        if (!terminal_) throw std::runtime_error("Terminal is not attached");
        if (name == "write") {
          const auto text = params.GetProperty("text");
          if (text.Type() != lynx_value_string) throw std::runtime_error("Expected text");
          (*terminal_)->write(text.StdString());
        } else {
          const auto key = params.GetProperty("key");
          if (key.Type() != lynx_value_string) throw std::runtime_error("Expected key");
          const auto control = params.GetProperty("control");
          const auto alt = params.GetProperty("alt");
          (*terminal_)->key(key.StdString(), control.Type() == lynx_value_bool && control.Bool(), alt.Type() == lynx_value_bool && alt.Bool());
        }
        lock.unlock();
        callback(kSuccess, LynxValue(true));
      } catch (const std::exception& error) {
        auto result = LynxValue(std::string(error.what()));
        lock.unlock();
        callback(kInvalidStateError, std::move(result));
      }
      return;
    }
    if (name == "renderFrame") {
      const bool ok = Render();
      auto result = ok ? LynxValue(true) : LynxValue(error_);
      lock.unlock();
      callback(ok ? kSuccess : kInvalidStateError, std::move(result));
      return;
    }
    lock.unlock();
    callback(kMethodNotFound, LynxValue(LynxValue::kCreateAsNullTag));
  }

 private:
  bool Render() {
    if (!attached_ || !terminal_ || viewport_.width == 0 || viewport_.height == 0) {
      error_ = "Waiting for an attached terminal and non-zero layout";
      return false;
    }
    try {
      if (!(*terminal_)->needs_frame()) {
        error_.clear();
        return true;
      }
      const auto viewport = (*terminal_)->viewport();
      // Borrowed IOSurface; Lynx owns its double buffer and presentation.
      auto surface = reinterpret_cast<IOSurfaceRef>(AcquireSurface(viewport.width, viewport.height));
      if (surface == nullptr) {
        error_ = "Lynx back buffer is unavailable";
        return false;
      }
      if (IOSurfaceGetWidth(surface) != viewport.width || IOSurfaceGetHeight(surface) != viewport.height ||
          IOSurfaceGetBytesPerElement(surface) != 4) {
        error_ = "Unexpected Lynx IOSurface dimensions or pixel layout";
        return false;
      }
      @autoreleasepool {
        // Use wgpu's actual MTLDevice, not a separately created Metal device.
        id<MTLDevice> device = (__bridge id<MTLDevice>)(void*)(*terminal_)->metal_device();
        auto desc = [MTLTextureDescriptor texture2DDescriptorWithPixelFormat:MTLPixelFormatBGRA8Unorm
            width:viewport.width height:viewport.height mipmapped:NO];
        desc.usage = MTLTextureUsageRenderTarget;
        desc.storageMode = MTLStorageModeShared;
        id<MTLTexture> texture = [device newTextureWithDescriptor:desc iosurface:surface plane:0];
        if (texture == nil) {
          error_ = "Metal could not import the Lynx IOSurface";
          return false;
        }
        // Rust retains the texture and waits for GPU completion before return.
        const auto handle = reinterpret_cast<uintptr_t>((__bridge void*)texture);
        const catus::FrameBuffer frame{handle};
        if (!(*terminal_)->render_frame(frame)) return true;
      }
      if (!SwapBack()) {
        (*terminal_)->invalidate_frame();
        error_ = "Lynx could not swap the rendered back buffer";
        return false;
      }
      error_.clear();
      MarkDirty();
      return true;
    } catch (const rust::Error& error) {
      error_ = error.what();
      return false;
    }
  }

  std::mutex mutex_;
  std::optional<rust::Box<catus::TerminalHandle>> terminal_;
  uint32_t terminal_id_ = 0;
  catus::Viewport viewport_{};
  bool attached_ = false;
  std::string error_;
};

lynx_native_view_t* CreateNativeTerminalView(void* opaque) {
  (void)opaque;
  return (new NativeTerminalView())->native_view();
}
}  // namespace

LYNX_REGISTER_ELEMENT("CatusNativeTerminalElement", "native-terminal", CreateNativeTerminalView, false, nullptr)
