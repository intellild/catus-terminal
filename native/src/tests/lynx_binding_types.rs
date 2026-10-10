use super::*;

#[test]
fn motion_decoding_preserves_coordinates_unknown_kinds_buttons_and_modifiers() {
    let mut raw: ffi::native_view_motion_event_t = unsafe { std::mem::zeroed() };
    raw.type_ = ffi::kNativeEventPanZoomUpdate;
    raw.device = ffi::kNativeDeviceTrackpad;
    raw.signal_kind = ffi::kNativeSignalScroll;
    raw.timestamp = 123;
    raw.pointer_id = 42;
    raw.device_id = 7;
    raw.buttons = ffi::kNativeMouseButtonPrimary | ffi::kNativeMouseButtonSecondary | (1 << 31);
    raw.x = 1.5;
    raw.y = 3.;
    raw.pageX = 11.;
    raw.pageY = 13.;
    raw.deltaX = -2.;
    raw.deltaY = 4.;
    raw.scale = 1.25;
    raw.ctrlKey = 2;
    raw.altKey = 1;
    raw.metaKey = 255;
    let event = MotionEvent::from(&raw);
    assert_eq!(event.kind, MotionKind::PanZoomUpdate);
    assert_eq!(event.device, DeviceKind::Trackpad);
    assert_eq!(event.signal, SignalKind::Scroll);
    assert_eq!(
        (event.timestamp, event.pointer_id, event.device_id),
        (123, 42, 7)
    );
    assert_eq!(
        (event.x, event.y, event.page_x, event.page_y),
        (1.5, 3., 11., 13.)
    );
    assert_eq!((event.delta_x, event.delta_y, event.scale), (-2., 4., 1.25));
    assert!(event.buttons.contains(MouseButton::Primary));
    assert!(event.buttons.contains(MouseButton::Secondary));
    assert!(!event.buttons.contains(MouseButton::Middle));
    assert_eq!(u32::from(event.buttons), raw.buttons);
    assert!(event.control && event.alt && event.meta && !event.shift);
    raw.type_ = 987;
    assert_eq!(MotionEvent::from(&raw).kind, MotionKind::Unrecognized(987));
}

#[test]
fn sdk_enums_preserve_unknown_discriminants_in_both_directions() {
    macro_rules! check {
        ($name:ident, $raw:ty, $known:ident, $constant:ident, $unknown:expr) => {
            assert_eq!($name::from(ffi::$constant), $name::$known);
            assert_eq!(<$raw>::from($name::$known), ffi::$constant);
            assert_eq!($name::from($unknown), $name::Unrecognized($unknown));
            assert_eq!(<$raw>::from($name::Unrecognized($unknown)), $unknown);
        };
    }
    check!(
        MotionKind,
        ffi::lynx_native_event_type_t,
        Down,
        kNativeEventDown,
        99
    );
    check!(
        DeviceKind,
        ffi::lynx_native_device_type_t,
        Mouse,
        kNativeDeviceMouse,
        99
    );
    check!(
        SignalKind,
        ffi::lynx_native_signal_kind_t,
        Scroll,
        kNativeSignalScroll,
        99
    );
    check!(
        SurfaceBufferMode,
        ffi::lynx_surface_buffer_mode_t,
        Triple,
        kTripleBuffer,
        99
    );
    check!(ValueType, ffi::lynx_value_type, Map, lynx_value_map, 255);
    check!(
        ApiStatus,
        ffi::lynx_api_status,
        MapExpected,
        lynx_api_map_expected,
        99
    );
    assert_eq!(InvokeStatus::from(-99), InvokeStatus::Unrecognized(-99));
    assert_eq!(i32::from(InvokeStatus::Unrecognized(-99)), -99);
    assert_eq!(
        i32::from(InvokeStatus::InvalidState),
        ffi::catus_invoke_invalid_state as i32
    );
}
