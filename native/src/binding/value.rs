//! Owned Lynx values. Property reads own a reference; callbacks borrow theirs.
use super::{
    ffi,
    protocol::Property,
    types::{ApiStatus, ValueType},
};
use anyhow::{Context, Result, ensure};
use std::{marker::PhantomData, rc::Rc};

/// Owns one SDK reference. Values remain on their originating Lynx thread.
pub struct Value {
    raw: ffi::lynx_value,
    _thread: PhantomData<Rc<()>>,
}

fn check(status: ffi::lynx_api_status) -> Result<()> {
    let status = ApiStatus::from(status);
    ensure!(
        status == ApiStatus::Ok,
        "Lynx value API failed ({status:?})"
    );
    Ok(())
}

impl Value {
    /// # Safety
    /// `raw` must be a valid borrowed SDK value on the current thread.
    pub(crate) unsafe fn borrow(raw: ffi::lynx_value) -> Result<Self> {
        // SAFETY: Retain the borrowed callback argument before wrapping it.
        check(unsafe {
            ffi::lynx_value_add_reference(std::ptr::null_mut(), raw, std::ptr::null_mut())
        })?;
        Ok(Self::owned(raw))
    }
    fn owned(raw: ffi::lynx_value) -> Self {
        Self {
            raw,
            _thread: PhantomData,
        }
    }
    fn create(make: impl FnOnce(*mut ffi::lynx_value) -> ffi::lynx_api_status) -> Result<Self> {
        // All-zero bits represent the SDK's scalar null value.
        let mut raw = unsafe { std::mem::zeroed() };
        check(make(&mut raw))?;
        Ok(Self::owned(raw))
    }
    pub fn null() -> Self {
        Self::owned(unsafe { std::mem::zeroed() })
    }
    pub fn boolean(value: bool) -> Result<Self> {
        Self::create(|raw| unsafe { ffi::lynx_value_create_bool(std::ptr::null_mut(), value, raw) })
    }
    pub fn integer(value: i64) -> Result<Self> {
        Self::create(|raw| unsafe {
            ffi::lynx_value_create_int64(std::ptr::null_mut(), value, raw)
        })
    }
    pub fn text(value: &str) -> Result<Self> {
        Self::create(|raw| unsafe {
            ffi::lynx_value_create_string_utf8(
                std::ptr::null_mut(),
                value.as_ptr().cast(),
                value.len(),
                raw,
            )
        })
    }
    pub fn map() -> Result<Self> {
        Self::create(|raw| unsafe { ffi::lynx_value_create_map(std::ptr::null_mut(), raw) })
    }
    pub fn get(&self, name: Property) -> Result<Self> {
        Self::create(|raw| unsafe {
            ffi::lynx_value_get_named_property(
                std::ptr::null_mut(),
                self.raw,
                name.as_cstr().as_ptr(),
                raw,
            )
        })
    }
    pub fn set(&self, name: Property, value: &Self) -> Result<()> {
        check(unsafe {
            ffi::lynx_value_set_named_property(
                std::ptr::null_mut(),
                self.raw,
                name.as_cstr().as_ptr(),
                value.raw,
            )
        })
    }
    pub fn value_type(&self) -> ValueType {
        self.raw.type_.into()
    }
    pub fn is_null(&self) -> bool {
        matches!(self.value_type(), ValueType::Null | ValueType::Undefined)
    }
    pub fn number(&self) -> Result<f64> {
        let mut number = 0.;
        check(unsafe { ffi::lynx_value_get_number(std::ptr::null_mut(), self.raw, &mut number) })?;
        Ok(number)
    }
    pub fn u32(&self) -> Result<u32> {
        let number = self.number()?;
        ensure!(
            number.is_finite() && number >= 0. && number <= u32::MAX as f64 && number.fract() == 0.,
            "Expected nonnegative u32 integer"
        );
        Ok(number as u32)
    }
    pub fn bool(&self) -> bool {
        let mut value = false;
        let status =
            unsafe { ffi::lynx_value_get_bool(std::ptr::null_mut(), self.raw, &mut value) };
        ApiStatus::from(status) == ApiStatus::Ok && value
    }
    pub fn string(&self) -> Result<String> {
        let mut size = 0;
        check(unsafe {
            ffi::lynx_value_get_string_utf8(
                std::ptr::null_mut(),
                self.raw,
                std::ptr::null_mut(),
                0,
                &mut size,
            )
        })?;
        let mut bytes = vec![0; size + 1];
        check(unsafe {
            ffi::lynx_value_get_string_utf8(
                std::ptr::null_mut(),
                self.raw,
                bytes.as_mut_ptr().cast(),
                bytes.len(),
                &mut size,
            )
        })?;
        bytes.truncate(size);
        String::from_utf8(bytes).context("Decode Lynx UTF-8 value")
    }
    // The SDK consumes one reference when receiving an event or invoke result,
    // just as the C++ wrapper retains before handing the value to the host.
    pub(crate) fn into_raw(self) -> ffi::lynx_value {
        let raw = self.raw;
        std::mem::forget(self);
        raw
    }
}

impl Drop for Value {
    fn drop(&mut self) {
        unsafe {
            ffi::lynx_value_remove_reference(std::ptr::null_mut(), self.raw, std::ptr::null_mut());
        }
    }
}
