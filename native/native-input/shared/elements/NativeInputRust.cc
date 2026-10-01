#include "NativeInputElement.h"
#include "rust/cxx.h"

#include <cmath>
#include <limits>

using lynx::pub::LynxValue;

LynxValue NativeInputElementView::RustSnapshot() const {
  LynxValue result(LynxValue::kCreateAsMapTag);
  result.SetProperty("nativeId", LynxValue(rust_counter_id_));
  result.SetProperty("value", LynxValue((*rust_counter_)->value()));
  result.SetProperty("cppCalls", LynxValue((*rust_counter_)->cpp_calls()));
  return result;
}

bool NativeInputElementView::InvokeRust(
    const char* method, const LynxValue& params,
    const std::function<void(int, LynxValue&&)>& callback) {
  if (!method) return false;
  const std::string name(method);
  if (name != "inspectRustObject" && name != "bindRustCounter" &&
      name != "addRustCounter") return false;

  if (name == "inspectRustObject") {
    const auto object = params.GetProperty("rustObject");
    LynxValue result(LynxValue::kCreateAsMapTag);
    result.SetProperty("lynxValueType", LynxValue(static_cast<int32_t>(object.Type())));
    result.SetProperty("isMap", LynxValue(object.Type() == lynx_value_map));
    result.SetProperty("hasAdd", LynxValue(object.HasProperty("add")));
    result.SetProperty("addValueType", LynxValue(static_cast<int32_t>(object.GetProperty("add").Type())));
    result.SetProperty("nativeId", object.GetProperty("nativeId"));
    callback(kSuccess, std::move(result));
    return true;
  }

  try {
    if (name == "bindRustCounter") {
      const auto object = params.GetProperty("rustObject");
      const auto id = object.GetProperty("nativeId");
      if (id.Type() != lynx_value_string) {
        callback(kInvalidParameter, LynxValue("rustObject.nativeId must be a string"));
        return true;
      }
      auto handle = catus::acquire_counter(rust::Str(id.StdString()));
      rust_counter_id_ = id.StdString();
      rust_counter_.emplace(std::move(handle));
    } else {
      if (!rust_counter_) {
        callback(kInvalidStateError, LynxValue("Bind a Rust counter first"));
        return true;
      }
      const auto delta = params.GetProperty("delta");
      const auto type = delta.Type();
      if (type != lynx_value_double && type != lynx_value_int32 && type != lynx_value_int64) {
        callback(kInvalidParameter, LynxValue("delta must be an int32"));
        return true;
      }
      const double number = delta.Number();
      if (!std::isfinite(number) || std::trunc(number) != number ||
          number < std::numeric_limits<int32_t>::min() ||
          number > std::numeric_limits<int32_t>::max()) {
        callback(kInvalidParameter, LynxValue("delta must be an int32"));
        return true;
      }
      (*rust_counter_)->add_from_cpp(static_cast<int32_t>(number));
    }
    callback(kSuccess, RustSnapshot());
  } catch (const rust::Error& error) {
    callback(kInvalidParameter, LynxValue(std::string(error.what())));
  }
  return true;
}
