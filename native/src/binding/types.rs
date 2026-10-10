//! Typed SDK constants. Only this layer translates the raw C discriminants.
use super::ffi;

// Keep unknown values intact when the host SDK adds a constant. Never transmute
// an unchecked host integer into a Rust enum or silently select another variant.
macro_rules! sdk_enum {
    ($name:ident, $raw:ty, { $($variant:ident => $constant:ident),+ $(,)? }) => {
        #[derive(Clone, Copy, Debug, PartialEq, Eq)]
        pub enum $name {
            $($variant,)+
            Unrecognized($raw),
        }
        impl From<$raw> for $name {
            fn from(raw: $raw) -> Self {
                match raw {
                    $(ffi::$constant => Self::$variant,)+
                    other => Self::Unrecognized(other),
                }
            }
        }
        impl From<$name> for $raw {
            fn from(value: $name) -> Self {
                match value {
                    $($name::$variant => ffi::$constant,)+
                    $name::Unrecognized(raw) => raw,
                }
            }
        }
    };
}

sdk_enum!(MotionKind, ffi::lynx_native_event_type_t, {
    Unknown => kNativeEventUnkown,
    Down => kNativeEventDown,
    Up => kNativeEventUp,
    Move => kNativeEventMove,
    Hover => kNativeEventHover,
    Signal => kNativeEventSignal,
    Cancel => kNativeEventCancel,
    PanZoomStart => kNativeEventPanZoomStart,
    PanZoomUpdate => kNativeEventPanZoomUpdate,
    PanZoomEnd => kNativeEventPanZoomEnd,
});
sdk_enum!(DeviceKind, ffi::lynx_native_device_type_t, {
    Touch => kNativeDeviceTouch,
    Mouse => kNativeDeviceMouse,
    Stylus => kNativeDeviceStylus,
    InvertedStylus => kNativeDeviceInvertedStylus,
    Trackpad => kNativeDeviceTrackpad,
});
sdk_enum!(SignalKind, ffi::lynx_native_signal_kind_t, {
    None => kNativeSignalNone,
    StartScroll => kNativeSignalStartScroll,
    Scroll => kNativeSignalScroll,
    EndScroll => kNativeSignalEndScroll,
});
sdk_enum!(SurfaceBufferMode, ffi::lynx_surface_buffer_mode_t, {
    Single => kSingleBuffer,
    Double => kDoubleBuffer,
    Triple => kTripleBuffer,
});
sdk_enum!(ValueType, ffi::lynx_value_type, {
    Null => lynx_value_null,
    Undefined => lynx_value_undefined,
    Bool => lynx_value_bool,
    Double => lynx_value_double,
    Int32 => lynx_value_int32,
    Uint32 => lynx_value_uint32,
    Int64 => lynx_value_int64,
    Uint64 => lynx_value_uint64,
    Nan => lynx_value_nan,
    String => lynx_value_string,
    Array => lynx_value_array,
    Map => lynx_value_map,
    ArrayBuffer => lynx_value_arraybuffer,
    Object => lynx_value_object,
    Function => lynx_value_function,
    FunctionTable => lynx_value_function_table,
    External => lynx_value_external,
    Extended => lynx_value_extended,
});
sdk_enum!(ApiStatus, ffi::lynx_api_status, {
    Ok => lynx_api_ok,
    Failed => lynx_api_failed,
    InvalidArgument => lynx_api_invalid_arg,
    NotSupported => lynx_api_not_support,
    BoolExpected => lynx_api_bool_expected,
    DoubleExpected => lynx_api_double_expected,
    Int32Expected => lynx_api_int32_expected,
    Uint32Expected => lynx_api_uint32_expected,
    Int64Expected => lynx_api_int64_expected,
    Uint64Expected => lynx_api_uint64_expected,
    StringExpected => lynx_api_string_expected,
    ArrayExpected => lynx_api_array_expected,
    MapExpected => lynx_api_map_expected,
    ExternalExpected => lynx_api_external_expected,
    ArrayBufferExpected => lynx_api_arraybuffer_expected,
    FunctionExpected => lynx_api_function_expected,
    IndexOutOfRange => lynx_api_index_out_of_range,
    HandleScopeMismatch => lynx_api_handle_scope_mismatch,
});

// Unlike the C enum discriminants, SDK invoke callbacks use a signed int.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InvokeStatus {
    Success,
    Unknown,
    MethodNotFound,
    InvalidParameter,
    InvalidState,
    Unrecognized(i32),
}
impl From<i32> for InvokeStatus {
    fn from(raw: i32) -> Self {
        match raw as ffi::catus_invoke_status {
            ffi::catus_invoke_success => Self::Success,
            ffi::catus_invoke_unknown => Self::Unknown,
            ffi::catus_invoke_method_not_found => Self::MethodNotFound,
            ffi::catus_invoke_invalid_parameter => Self::InvalidParameter,
            ffi::catus_invoke_invalid_state => Self::InvalidState,
            _ => Self::Unrecognized(raw),
        }
    }
}
impl From<InvokeStatus> for i32 {
    fn from(value: InvokeStatus) -> Self {
        match value {
            InvokeStatus::Success => ffi::catus_invoke_success as Self,
            InvokeStatus::Unknown => ffi::catus_invoke_unknown as Self,
            InvokeStatus::MethodNotFound => ffi::catus_invoke_method_not_found as Self,
            InvokeStatus::InvalidParameter => ffi::catus_invoke_invalid_parameter as Self,
            InvokeStatus::InvalidState => ffi::catus_invoke_invalid_state as Self,
            InvokeStatus::Unrecognized(raw) => raw,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MouseButton {
    Primary,
    Secondary,
    Middle,
    Back,
    Forward,
}
impl MouseButton {
    fn bit(self) -> u32 {
        match self {
            Self::Primary => ffi::kNativeMouseButtonPrimary,
            Self::Secondary => ffi::kNativeMouseButtonSecondary,
            Self::Middle => ffi::kNativeMouseButtonMiddle,
            Self::Back => ffi::kNativeMouseButtonBack,
            Self::Forward => ffi::kNativeMouseButtonForward,
        }
    }
}
/// Mouse buttons are a bitset, not an enum discriminant. Preserve combinations
/// and unknown bits from newer hosts, while exposing named button queries.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct MouseButtons(u32);
impl MouseButtons {
    pub const EMPTY: Self = Self(0);
    pub fn contains(self, button: MouseButton) -> bool {
        self.0 & button.bit() != 0
    }
}
impl From<MouseButton> for MouseButtons {
    fn from(button: MouseButton) -> Self {
        Self(button.bit())
    }
}
impl From<u32> for MouseButtons {
    fn from(bits: u32) -> Self {
        Self(bits)
    }
}
impl From<MouseButtons> for u32 {
    fn from(buttons: MouseButtons) -> Self {
        buttons.0
    }
}
impl std::ops::BitOr for MouseButtons {
    type Output = Self;
    fn bitor(self, other: Self) -> Self {
        Self(self.0 | other.0)
    }
}

/// Decoded input data. No C field names, integer discriminants or u8 booleans
/// escape into native view implementations.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct MotionEvent {
    pub timestamp: u64,
    pub kind: MotionKind,
    pub device: DeviceKind,
    pub signal: SignalKind,
    pub pointer_id: i32,
    pub device_id: i32,
    pub buttons: MouseButtons,
    pub x: f32,
    pub y: f32,
    pub page_x: f32,
    pub page_y: f32,
    pub delta_x: f32,
    pub delta_y: f32,
    pub scale: f64,
    pub alt: bool,
    pub control: bool,
    pub shift: bool,
    pub meta: bool,
}
impl From<&ffi::native_view_motion_event_t> for MotionEvent {
    fn from(raw: &ffi::native_view_motion_event_t) -> Self {
        Self {
            timestamp: raw.timestamp,
            kind: raw.type_.into(),
            device: raw.device.into(),
            signal: raw.signal_kind.into(),
            pointer_id: raw.pointer_id,
            device_id: raw.device_id,
            buttons: raw.buttons.into(),
            x: raw.x,
            y: raw.y,
            page_x: raw.pageX,
            page_y: raw.pageY,
            delta_x: raw.deltaX,
            delta_y: raw.deltaY,
            scale: raw.scale,
            alt: raw.altKey != 0,
            control: raw.ctrlKey != 0,
            shift: raw.shiftKey != 0,
            meta: raw.metaKey != 0,
        }
    }
}

#[cfg(test)]
#[path = "../tests/lynx_binding_types.rs"]
mod tests;
