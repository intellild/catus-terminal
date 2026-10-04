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
#include <stdexcept>

namespace {
using lynx::pub::LynxValue;

class NativeTerminalView : public lynx::pub::LynxNativeView {
 public:
  bool IsSurfaceEnabled() override { return true; }

  void OnAttach() override {
    std::lock_guard lock(mutex_);
    attached_ = true;
    if (renderer_) (*renderer_)->invalidate_grid();
    Render();
  }
  void OnDetach() override {
    std::lock_guard lock(mutex_);
    attached_ = false;
  }
  void OnDestroy() override {
    std::lock_guard lock(mutex_);
    terminal_.reset();
    renderer_.reset();
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
      width_ = height_ = 0;
      pixel_verified_ = false;
      error_ = "Terminal layout is zero or exceeds the texture size limit";
      return;
    }
    width_ = static_cast<uint32_t>(std::ceil(width * pixel_ratio));
    height_ = static_cast<uint32_t>(std::ceil(height * pixel_ratio));
    pixel_ratio_ = pixel_ratio;
    Render();
  }
  void OnPropertiesChanged(const LynxValue& attrs, const LynxValue& events) override {
    (void)events;
    if (!attrs.HasProperty("terminal-id")) return;
    auto value = attrs.GetProperty("terminal-id");
    if (value.Type() != lynx_value_string) return;
    std::lock_guard lock(mutex_);
    const auto id = value.StdString();
    if (id == terminal_id_) return;
    try {
      if (id.empty()) terminal_.reset();
      else terminal_.emplace(catus::acquire_terminal(id));
      terminal_id_ = id;
      if (renderer_) (*renderer_)->clear_atlas();
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
    if (name != "getRendererInfo" && name != "renderTriangle" && name != "renderAtlas" && name != "clearAtlas") {
      lock.unlock();
      callback(kMethodNotFound, LynxValue(LynxValue::kCreateAsNullTag));
      return;
    }
    if (name == "renderAtlas" || name == "clearAtlas") atlas_mode_ = true;
    if (name == "renderTriangle") atlas_mode_ = false;
    if (name == "clearAtlas" && renderer_) (*renderer_)->clear_atlas();
    if (name != "getRendererInfo" && !Render()) {
      auto error = LynxValue(error_);
      lock.unlock();
      callback(kInvalidStateError, std::move(error));
      return;
    }
    auto result = Snapshot();
    lock.unlock();
    callback(kSuccess, std::move(result));
  }

 private:
  bool Render() {
    if (!attached_ || width_ == 0 || height_ == 0) {
      error_ = "Waiting for an attached, non-zero layout";
      return false;
    }
    try {
      if (!renderer_) renderer_.emplace(catus::create_terminal_renderer());
      if (terminal_ && !catus::prepare_terminal_frame(**renderer_, **terminal_, width_, height_, pixel_ratio_)) {
        error_.clear();
        return true;
      }
      // Borrowed IOSurface; Lynx owns its double buffer and presentation.
      auto surface = reinterpret_cast<IOSurfaceRef>(AcquireSurface(width_, height_));
      if (surface == nullptr) {
        error_ = "Lynx back buffer is unavailable";
        return false;
      }
      if (IOSurfaceGetWidth(surface) != width_ || IOSurfaceGetHeight(surface) != height_ ||
          IOSurfaceGetBytesPerElement(surface) != 4) {
        error_ = "Unexpected Lynx IOSurface dimensions or pixel layout";
        return false;
      }
      @autoreleasepool {
        // Use wgpu's actual MTLDevice, not a separately created Metal device.
        id<MTLDevice> device = (__bridge id<MTLDevice>)(void*)(*renderer_)->metal_device();
        auto desc = [MTLTextureDescriptor texture2DDescriptorWithPixelFormat:MTLPixelFormatBGRA8Unorm
            width:width_ height:height_ mipmapped:NO];
        desc.usage = MTLTextureUsageRenderTarget;
        desc.storageMode = MTLStorageModeShared;
        id<MTLTexture> texture = [device newTextureWithDescriptor:desc iosurface:surface plane:0];
        if (texture == nil) {
          error_ = "Metal could not import the Lynx IOSurface";
          return false;
        }
        // Rust retains the texture and waits for GPU completion before return.
        const auto handle = reinterpret_cast<uintptr_t>((__bridge void*)texture);
        if (terminal_) {
          if (!catus::render_terminal(**renderer_, **terminal_, handle, width_, height_, pixel_ratio_)) return true;
        } else if (atlas_mode_) (*renderer_)->render_atlas(handle, width_, height_, static_cast<float>(pixel_ratio_));
        else (*renderer_)->render_triangle(handle, width_, height_);
        SamplePixels(surface);
      }
      if (!SwapBack()) {
        (*renderer_)->invalidate_grid();
        error_ = "Lynx could not swap the rendered back buffer";
        return false;
      }
      ++presented_frames_;
      error_.clear();
      MarkDirty();
      return true;
    } catch (const rust::Error& error) {
      error_ = error.what();
      return false;
    }
  }

  void SamplePixels(IOSurfaceRef surface) {
    pixel_verified_ = false;
    if (IOSurfaceLock(surface, kIOSurfaceLockReadOnly, nullptr) != kIOReturnSuccess) return;
    const auto* bytes = static_cast<const uint8_t*>(IOSurfaceGetBaseAddress(surface));
    if (bytes != nullptr) {
      const size_t stride = IOSurfaceGetBytesPerRow(surface);
      auto rgb = [&](uint32_t x, uint32_t y) -> uint32_t {
        const auto* p = bytes + y * stride + x * 4;
        return (uint32_t(p[2]) << 16) | (uint32_t(p[1]) << 8) | p[0];
      };
      center_rgb_ = rgb(width_ / 2, height_ / 2);
      corner_rgb_ = rgb(0, 0);
      // Text need not cover the center. Inspect actual foreground pixels in
      // the IOSurface presented by Lynx (rather than relying on submit success).
      for (uint32_t y = 0; y < height_ && !pixel_verified_; ++y) {
        for (uint32_t x = 0; x < width_; ++x) {
          if (rgb(x, y) != corner_rgb_) { pixel_verified_ = true; break; }
        }
      }
    }
    IOSurfaceUnlock(surface, kIOSurfaceLockReadOnly, nullptr);
  }

  LynxValue Snapshot() const {
    LynxValue result(LynxValue::kCreateAsMapTag);
    result.SetProperty("mode", LynxValue(std::string(terminal_ ? "terminal" : atlas_mode_ ? "atlas" : "triangle")));
    result.SetProperty("atlasPages", LynxValue(static_cast<int32_t>(renderer_ ? (*renderer_)->atlas_pages() : 0)));
    result.SetProperty("atlasUploads", LynxValue(static_cast<int64_t>(renderer_ ? (*renderer_)->atlas_uploads() : 0)));
    result.SetProperty("atlasInstances", LynxValue(static_cast<int32_t>(renderer_ ? (*renderer_)->atlas_instances() : 0)));
    result.SetProperty("fontFamily", LynxValue(std::string("Menlo")));
    result.SetProperty("fontPixels", LynxValue(static_cast<double>(renderer_ ? (*renderer_)->font_pixels() : 0)));
    result.SetProperty("cachedGlyphs", LynxValue(static_cast<int32_t>(renderer_ ? (*renderer_)->cached_glyphs() : 0)));
    result.SetProperty("rasterizations", LynxValue(static_cast<int64_t>(renderer_ ? (*renderer_)->rasterizations() : 0)));
    result.SetProperty("missingGlyphs", LynxValue(static_cast<int64_t>(renderer_ ? (*renderer_)->missing_glyphs() : 0)));
    result.SetProperty("backend", LynxValue(std::string("Metal")));
    result.SetProperty("transport", LynxValue(std::string("Lynx IOSurface -> MTLTexture -> wgpu")));
    result.SetProperty("width", LynxValue(static_cast<int32_t>(width_)));
    result.SetProperty("height", LynxValue(static_cast<int32_t>(height_)));
    result.SetProperty("pixelRatio", LynxValue(static_cast<double>(pixel_ratio_)));
    result.SetProperty("frames", LynxValue(static_cast<int64_t>(presented_frames_)));
    result.SetProperty("gpuFrames", LynxValue(static_cast<int64_t>(renderer_ ? (*renderer_)->frames() : 0)));
    result.SetProperty("adapter", LynxValue(renderer_ ? std::string((*renderer_)->adapter_name()) : ""));
    result.SetProperty("centerRGB", LynxValue(static_cast<int32_t>(center_rgb_)));
    result.SetProperty("cornerRGB", LynxValue(static_cast<int32_t>(corner_rgb_)));
    result.SetProperty("pixelVerified", LynxValue(pixel_verified_));
    result.SetProperty("error", LynxValue(error_));
    if (terminal_) {
      result.SetProperty("shell", LynxValue(std::string((*terminal_)->shell())));
      result.SetProperty("exited", LynxValue((*terminal_)->exited()));
      result.SetProperty("screenText", LynxValue(std::string((*terminal_)->screen_text())));
    }
    return result;
  }

  std::mutex mutex_;
  std::optional<rust::Box<catus::TerminalRenderer>> renderer_;
  std::optional<rust::Box<catus::TerminalHandle>> terminal_;
  std::string terminal_id_;
  uint32_t width_ = 0, height_ = 0;
  float pixel_ratio_ = 1;
  bool attached_ = false, pixel_verified_ = false, atlas_mode_ = false;
  uint64_t presented_frames_ = 0;
  uint32_t center_rgb_ = 0, corner_rgb_ = 0;
  std::string error_;
};

lynx_native_view_t* CreateNativeTerminalView(void* opaque) {
  (void)opaque;
  return (new NativeTerminalView())->native_view();
}
}  // namespace

LYNX_REGISTER_ELEMENT("CatusNativeTerminalElement", "native-terminal", CreateNativeTerminalView, false, nullptr)
