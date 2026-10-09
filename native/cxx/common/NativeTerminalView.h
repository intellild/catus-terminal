#pragma once

#include "common/NativeFrameCallbacks.h"
#include "platform/RustBridge.h"
#include <lynx_native_view.h>
#include "rust/cxx.h"

#include <cmath>
#include <mutex>
#include <optional>
#include <string>
#include <limits>
#include <stdexcept>
#include <utility>

namespace catus {
using lynx::pub::LynxValue;

class NativeTerminalView : public lynx::pub::LynxNativeView {
 public:
  explicit NativeTerminalView(std::shared_ptr<catus::NativeFrameCallbacks> host)
      : frame_callbacks_(std::move(host)), frame_target_(std::make_shared<catus::NativeFrameTarget>()),
        frame_registration_(frame_callbacks_->callbacks().register_frame_callback(frame_target_)) {
    frame_target_->SetRender([this](int64_t deadline) {
      std::unique_lock lock(mutex_, std::try_to_lock);
      if (lock.owns_lock() && catus::monotonic_now_ns() < deadline) {
        Render(deadline);
        const bool focus = std::exchange(focus_pending_, false);
        lock.unlock();
        if (focus) Focus();
      }
    });
  }

  ~NativeTerminalView() override {
    frame_registration_->set_active(false);
    frame_target_->SetRender(nullptr);
  }

  bool IsSurfaceEnabled() override { return true; }

  void OnAttach() override {
    std::lock_guard lock(mutex_);
    attached_ = true;
    if (terminal_) (*terminal_)->invalidate_frame();
    UpdateFrameLoop();
  }
  void OnDetach() override {
    std::lock_guard lock(mutex_);
    attached_ = false;
    UpdateFrameLoop();
  }
  void OnDestroy() override {
    std::lock_guard lock(mutex_);
    attached_ = false;
    UnbindTerminal();
    terminal_.reset();
    terminal_id_ = 0;
    UpdateFrameLoop();
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
      UpdateFrameLoop();
      return;
    }
    viewport_.width = static_cast<uint32_t>(std::ceil(width * pixel_ratio));
    viewport_.height = static_cast<uint32_t>(std::ceil(height * pixel_ratio));
    viewport_.pixel_ratio = pixel_ratio;
    try {
      if (terminal_) (*terminal_)->resize_viewport(viewport_);
    } catch (const rust::Error& error) { error_ = error.what(); }
    UpdateFrameLoop();
  }
  void OnPropertiesChanged(const LynxValue& attrs, const LynxValue& events) override {
    (void)events;
    if (!attrs.HasProperty("terminal-id")) return;
    auto value = attrs.GetProperty("terminal-id");
    const auto type = value.Type();
    if (type != lynx_value_double && type != lynx_value_int32 && type != lynx_value_int64) return;
    const double number = value.Number();
    if (!std::isfinite(number) || number < 0 ||
        number > std::numeric_limits<uint32_t>::max() || std::floor(number) != number) return;
    std::lock_guard lock(mutex_);
    const auto id = static_cast<uint32_t>(number);
    if (id == terminal_id_) return;
    if (id == 0) {
      UnbindTerminal();
      terminal_.reset();
      terminal_id_ = 0;
      error_.clear();
      UpdateFrameLoop();
      return;
    }
    try {
      auto terminal = catus::acquire_terminal(id);
      if (viewport_.width != 0 && viewport_.height != 0) terminal->resize_viewport(viewport_);
      terminal_.emplace(std::move(terminal));
      terminal_id_ = id;
      BindTerminal(**terminal_);
      if (terminal_) (*terminal_)->invalidate_frame();
    } catch (const rust::Error& error) { error_ = error.what(); }
    UpdateFrameLoop();
  }
  void OnMethodInvoked(const char* method, const LynxValue& params,
      std::function<void(int, LynxValue&&)> callback) override {
    std::unique_lock lock(mutex_);
    const std::string name = method ? method : "";
    if (name == "focus") {
      lock.unlock();
      Focus();
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
      const bool focus = std::exchange(focus_pending_, false);
      lock.unlock();
      if (focus) Focus();
      callback(ok ? kSuccess : kInvalidStateError, std::move(result));
      return;
    }
    lock.unlock();
    callback(kMethodNotFound, LynxValue(LynxValue::kCreateAsNullTag));
  }

 protected:
  virtual void Focus() { RequestFocus(); }
  virtual bool PresentFrame() { const bool ok = SwapBack(); if (ok) MarkDirty(); return ok; }
  virtual void BindTerminal(const TerminalHandle&) {}
  virtual void UnbindTerminal() {}
  // The platform lends a native buffer to Rust and waits for GPU completion.
  virtual bool RenderSurface(TerminalHandle& terminal, const Viewport& viewport,
                             int64_t deadline) = 0;

 private:
  void UpdateFrameLoop() {
    frame_registration_->set_active(attached_ && terminal_id_ != 0 && terminal_ &&
        viewport_.width != 0 && viewport_.height != 0);
  }

  void FocusAfterFirstFrame() {
    if (needs_focus_) {
      needs_focus_ = false;
      focus_pending_ = true;
    }
  }

  bool Render(int64_t deadline = std::numeric_limits<int64_t>::max()) {
    if (catus::monotonic_now_ns() >= deadline) return true;
    if (terminal_id_ == 0) return true;
    if (!attached_ || !terminal_ || viewport_.width == 0 || viewport_.height == 0) {
      error_ = "Waiting for an attached terminal and non-zero layout";
      return false;
    }
    try {
      if (!RenderSurface(**terminal_, viewport_, deadline)) return true;
      if (catus::monotonic_now_ns() >= deadline) {
        (*terminal_)->invalidate_frame();
        return true;
      }
      if (!PresentFrame()) {
        (*terminal_)->invalidate_frame();
        error_ = "Lynx could not swap the rendered back buffer";
        return false;
      }
      error_.clear();
      FocusAfterFirstFrame();
      return true;
    } catch (const std::exception& error) {
      error_ = error.what();
      return false;
    }
  }

  std::mutex mutex_;
  std::shared_ptr<catus::NativeFrameCallbacks> frame_callbacks_;
  std::shared_ptr<catus::NativeFrameTarget> frame_target_;
  rust::Box<catus::FrameRegistration> frame_registration_;
  std::optional<rust::Box<catus::TerminalHandle>> terminal_;
  uint32_t terminal_id_ = 0;
  catus::Viewport viewport_{};
  bool attached_ = false;
  bool needs_focus_ = true;
  bool focus_pending_ = false;
  std::string error_;
};

}  // namespace catus
