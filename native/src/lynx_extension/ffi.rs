//! SDK-generated C ABI; ergonomic aliases do not redefine the host types.
#![allow(
    non_camel_case_types,
    non_snake_case,
    non_upper_case_globals,
    dead_code
)]

use napi::sys::{napi_env, napi_value};

include!(concat!(env!("OUT_DIR"), "/lynx_extension_bindings.rs"));

pub use lynx_extension_module_t as RawModule;
pub use lynx_view_t as LynxView;
pub use lynx_vsync_observer_t as VsyncObserver;

// SAFETY: Both bindings name the same SDK opaque type. No Rust layout is
// assumed; cxx verifies the named C++ type at its generated boundary.
unsafe impl cxx::ExternType for LynxView {
    type Id = cxx::type_id!("lynx_view_t");
    type Kind = cxx::kind::Opaque;
}
