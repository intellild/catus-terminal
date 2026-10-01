#pragma once

#include <functional>
#include <string>
#include <utility>

#if __has_include(<lynx_extension.h>)
#include <lynx_extension.h>
#elif __has_include(<lynx/extension.h>)
#include <lynx/extension.h>
#endif

#include <lynx_native_view.h>

class NativeInputElementView : public lynx::pub::LynxNativeView {
 public:
  explicit NativeInputElementView(void* opaque)
      : lynx_view_(static_cast<lynx_view_t*>(opaque)) {}

  void OnPropertiesChanged(const lynx::pub::LynxValue& attrs,
                           const lynx::pub::LynxValue& events) override {
    (void)events;
    if (attrs.HasProperty("value")) {
      SetValue(attrs.GetProperty("value").StdString());
    }
    if (attrs.HasProperty("placeholder")) {
      OnPlaceholderChanged(attrs.GetProperty("placeholder").StdString());
    }
  }

  void OnMethodInvoked(
      const char* method,
      const lynx::pub::LynxValue& params,
      std::function<void(int, lynx::pub::LynxValue&&)> callback) override {
    if (method != nullptr && std::string(method) == "setValue") {
      if (!params.HasProperty("value") ||
          params.GetProperty("value").Type() != lynx_value_string) {
        callback(kInvalidParameter,
                 lynx::pub::LynxValue(
                     lynx::pub::LynxValue::kCreateAsNullTag));
        return;
      }
      SetValue(params.GetProperty("value").StdString());
      callback(kSuccess,
               lynx::pub::LynxValue(
                   lynx::pub::LynxValue::kCreateAsNullTag));
      return;
    }

    if (method != nullptr && std::string(method) == "focus") {
      callback(Focus() ? kSuccess : kInvalidStateError,
               lynx::pub::LynxValue(lynx::pub::LynxValue::kCreateAsNullTag));
      return;
    }

    if (method != nullptr && std::string(method) == "getValue") {
      callback(kSuccess, lynx::pub::LynxValue(value_));
      return;
    }

    callback(kMethodNotFound,
             lynx::pub::LynxValue(lynx::pub::LynxValue::kCreateAsNullTag));
  }

 protected:
  lynx_view_t* lynx_view() const { return lynx_view_; }
  const std::string& value() const { return value_; }

  virtual void OnValueChanged(const std::string& value) { (void)value; }
  virtual void OnPlaceholderChanged(const std::string& value) { (void)value; }
  virtual bool Focus() { return false; }

  void HandleNativeInput(const std::string& value) {
    // Do not write back to NSTextField during an IME composition.
    value_ = value;
    lynx::pub::LynxValue detail(lynx::pub::LynxValue::kCreateAsMapTag);
    detail.SetProperty("value", lynx::pub::LynxValue(value));
    TriggerEvent("input", std::move(detail));
  }

 private:
  void SetValue(const std::string& value) {
    value_ = value;
    OnValueChanged(value_);
  }

  lynx_view_t* lynx_view_ = nullptr;
  std::string value_;
};

lynx_native_view_t* CreateNativeInputElementNativeView(void* opaque);
