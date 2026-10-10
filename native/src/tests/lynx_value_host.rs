//! Ref-counted C value host used to verify ownership across the Rust bridge.
use super::*;
use std::{cell::Cell, collections::HashMap};

thread_local! { pub(super) static LIVE_VALUES: Cell<usize> = const { Cell::new(0) }; }
enum HeapValue {
    Text(Vec<u8>),
    Map(RefCell<HashMap<String, ffi::lynx_value>>),
}
struct Heap {
    refs: Cell<usize>,
    value: HeapValue,
}
fn scalar(kind: ffi::lynx_value_type) -> ffi::lynx_value {
    let mut raw: ffi::lynx_value = unsafe { std::mem::zeroed() };
    raw.type_ = kind;
    raw
}
fn heap(value: HeapValue, kind: ffi::lynx_value_type) -> ffi::lynx_value {
    LIVE_VALUES.set(LIVE_VALUES.get() + 1);
    let mut raw = scalar(kind);
    raw.__bindgen_anon_1.val_ptr = Box::into_raw(Box::new(Heap {
        refs: Cell::new(1),
        value,
    }))
    .cast();
    raw
}
fn is_heap(raw: ffi::lynx_value) -> bool {
    matches!(raw.type_, ffi::lynx_value_string | ffi::lynx_value_map)
}
unsafe fn get_heap<'a>(raw: ffi::lynx_value) -> &'a Heap {
    unsafe { &*raw.__bindgen_anon_1.val_ptr.cast::<Heap>() }
}
#[unsafe(no_mangle)]
unsafe extern "C" fn lynx_value_add_reference(
    _env: ffi::lynx_api_env,
    raw: ffi::lynx_value,
    _result: *mut ffi::lynx_value_ref,
) -> ffi::lynx_api_status {
    if is_heap(raw) {
        let heap = unsafe { get_heap(raw) };
        heap.refs.set(heap.refs.get() + 1);
    }
    ffi::lynx_api_ok
}
#[unsafe(no_mangle)]
unsafe extern "C" fn lynx_value_remove_reference(
    _env: ffi::lynx_api_env,
    raw: ffi::lynx_value,
    _reference: ffi::lynx_value_ref,
) -> ffi::lynx_api_status {
    if is_heap(raw) {
        let heap = unsafe { get_heap(raw) };
        heap.refs.set(heap.refs.get() - 1);
        if heap.refs.get() == 0 {
            let heap = unsafe { Box::from_raw(raw.__bindgen_anon_1.val_ptr.cast::<Heap>()) };
            if let HeapValue::Map(values) = heap.value {
                for value in values.into_inner().into_values() {
                    unsafe {
                        lynx_value_remove_reference(
                            std::ptr::null_mut(),
                            value,
                            std::ptr::null_mut(),
                        );
                    }
                }
            }
            LIVE_VALUES.set(LIVE_VALUES.get() - 1);
        }
    }
    ffi::lynx_api_ok
}
#[unsafe(no_mangle)]
unsafe extern "C" fn lynx_value_create_bool(
    _env: ffi::lynx_api_env,
    value: bool,
    result: *mut ffi::lynx_value,
) -> ffi::lynx_api_status {
    let mut raw = scalar(ffi::lynx_value_bool);
    raw.__bindgen_anon_1.val_bool = value;
    unsafe {
        *result = raw;
    }
    ffi::lynx_api_ok
}
#[unsafe(no_mangle)]
unsafe extern "C" fn lynx_value_create_int64(
    _env: ffi::lynx_api_env,
    value: i64,
    result: *mut ffi::lynx_value,
) -> ffi::lynx_api_status {
    let mut raw = scalar(ffi::lynx_value_int64);
    raw.__bindgen_anon_1.val_int64 = value;
    unsafe {
        *result = raw;
    }
    ffi::lynx_api_ok
}
#[unsafe(no_mangle)]
unsafe extern "C" fn lynx_value_create_string_utf8(
    _env: ffi::lynx_api_env,
    text: *const c_char,
    size: usize,
    result: *mut ffi::lynx_value,
) -> ffi::lynx_api_status {
    let bytes = unsafe { std::slice::from_raw_parts(text.cast(), size) }.to_vec();
    unsafe {
        *result = heap(HeapValue::Text(bytes), ffi::lynx_value_string);
    }
    ffi::lynx_api_ok
}
#[unsafe(no_mangle)]
unsafe extern "C" fn lynx_value_create_map(
    _env: ffi::lynx_api_env,
    result: *mut ffi::lynx_value,
) -> ffi::lynx_api_status {
    unsafe {
        *result = heap(
            HeapValue::Map(RefCell::new(HashMap::new())),
            ffi::lynx_value_map,
        );
    }
    ffi::lynx_api_ok
}
#[unsafe(no_mangle)]
unsafe extern "C" fn lynx_value_get_number(
    _env: ffi::lynx_api_env,
    raw: ffi::lynx_value,
    result: *mut f64,
) -> ffi::lynx_api_status {
    let value = unsafe {
        match raw.type_ {
            ffi::lynx_value_double => raw.__bindgen_anon_1.val_double,
            ffi::lynx_value_int64 => raw.__bindgen_anon_1.val_int64 as f64,
            _ => return ffi::lynx_api_double_expected,
        }
    };
    unsafe {
        *result = value;
    }
    ffi::lynx_api_ok
}
#[unsafe(no_mangle)]
unsafe extern "C" fn lynx_value_get_bool(
    _env: ffi::lynx_api_env,
    raw: ffi::lynx_value,
    result: *mut bool,
) -> ffi::lynx_api_status {
    if raw.type_ != ffi::lynx_value_bool {
        return ffi::lynx_api_bool_expected;
    }
    unsafe {
        *result = raw.__bindgen_anon_1.val_bool;
    }
    ffi::lynx_api_ok
}
#[unsafe(no_mangle)]
unsafe extern "C" fn lynx_value_get_string_utf8(
    _env: ffi::lynx_api_env,
    raw: ffi::lynx_value,
    buffer: *mut c_char,
    size: usize,
    result: *mut usize,
) -> ffi::lynx_api_status {
    if raw.type_ != ffi::lynx_value_string {
        return ffi::lynx_api_string_expected;
    }
    let HeapValue::Text(bytes) = &unsafe { get_heap(raw) }.value else {
        return ffi::lynx_api_failed;
    };
    unsafe {
        *result = bytes.len();
        if !buffer.is_null() && size > 0 {
            let length = bytes.len().min(size - 1);
            std::ptr::copy_nonoverlapping(bytes.as_ptr(), buffer.cast(), length);
            *buffer.add(length) = 0;
        }
    }
    ffi::lynx_api_ok
}
#[unsafe(no_mangle)]
unsafe extern "C" fn lynx_value_get_named_property(
    env: ffi::lynx_api_env,
    raw: ffi::lynx_value,
    name: *const c_char,
    result: *mut ffi::lynx_value,
) -> ffi::lynx_api_status {
    if raw.type_ != ffi::lynx_value_map {
        return ffi::lynx_api_map_expected;
    }
    let HeapValue::Map(values) = &unsafe { get_heap(raw) }.value else {
        return ffi::lynx_api_failed;
    };
    let name = unsafe { CStr::from_ptr(name) }.to_string_lossy();
    let value = values
        .borrow()
        .get(name.as_ref())
        .copied()
        .unwrap_or_else(|| scalar(ffi::lynx_value_undefined));
    unsafe {
        lynx_value_add_reference(env, value, std::ptr::null_mut());
        *result = value;
    }
    ffi::lynx_api_ok
}
#[unsafe(no_mangle)]
unsafe extern "C" fn lynx_value_set_named_property(
    env: ffi::lynx_api_env,
    raw: ffi::lynx_value,
    name: *const c_char,
    value: ffi::lynx_value,
) -> ffi::lynx_api_status {
    if raw.type_ != ffi::lynx_value_map {
        return ffi::lynx_api_map_expected;
    }
    let HeapValue::Map(values) = &unsafe { get_heap(raw) }.value else {
        return ffi::lynx_api_failed;
    };
    let name = unsafe { CStr::from_ptr(name) }
        .to_string_lossy()
        .into_owned();
    unsafe {
        lynx_value_add_reference(env, value, std::ptr::null_mut());
    }
    if let Some(old) = values.borrow_mut().insert(name, value) {
        unsafe {
            lynx_value_remove_reference(env, old, std::ptr::null_mut());
        }
    }
    ffi::lynx_api_ok
}
