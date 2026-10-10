#pragma once

#include <capi/lynx_env_capi.h>
#include <capi/lynx_extension_module_capi.h>
#include <capi/lynx_native_view_capi.h>
#include <lynx_native_view.h>

// Invoke codes are published as C++ class constants. Expose their SDK values
// to bindgen instead of maintaining duplicate numeric literals in Rust.
enum catus_invoke_status {
  catus_invoke_success = lynx::pub::LynxNativeView::kSuccess,
  catus_invoke_unknown = lynx::pub::LynxNativeView::kUnknown,
  catus_invoke_method_not_found = lynx::pub::LynxNativeView::kMethodNotFound,
  catus_invoke_invalid_parameter = lynx::pub::LynxNativeView::kInvalidParameter,
  catus_invoke_invalid_state = lynx::pub::LynxNativeView::kInvalidStateError,
};
