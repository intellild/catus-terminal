use napi_derive::napi;
use std::collections::HashMap;
use std::sync::atomic::{AtomicI32, AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock, Weak};

#[cxx::bridge(namespace = "catus")]
mod ffi {
    extern "Rust" {
        type CounterHandle;
        fn acquire_counter(id: &str) -> Result<Box<CounterHandle>>;
        fn value(self: &CounterHandle) -> i32;
        fn cpp_calls(self: &CounterHandle) -> u32;
        fn add_from_cpp(self: &CounterHandle, delta: i32) -> Result<i32>;
    }
}

struct CounterState {
    value: AtomicI32,
    cpp_calls: AtomicU32,
}

impl CounterState {
    fn add(&self, delta: i32) -> Result<i32, String> {
        self.value
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |value| {
                value.checked_add(delta)
            })
            .map(|previous| previous + delta)
            .map_err(|_| "Counter overflow".to_owned())
    }
}

type Registry = Mutex<HashMap<String, Weak<CounterState>>>;
fn registry() -> &'static Registry {
    static REGISTRY: OnceLock<Registry> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

// The N-API wrapper owns the Rust state. An ID is a lookup key, never a pointer.
#[napi]
pub struct RustCounter {
    state: Arc<CounterState>,
    #[napi(readonly)]
    pub native_id: String,
}

#[napi(object)]
pub struct NativeCounterHandle {
    pub native_id: String,
}

#[napi]
impl RustCounter {
    #[napi(constructor)]
    pub fn new(initial: i32) -> Self {
        static NEXT_ID: AtomicU64 = AtomicU64::new(1);
        let native_id = format!("rust-counter-{}", NEXT_ID.fetch_add(1, Ordering::Relaxed));
        let state = Arc::new(CounterState {
            value: AtomicI32::new(initial),
            cpp_calls: AtomicU32::new(0),
        });
        registry()
            .lock()
            .unwrap()
            .insert(native_id.clone(), Arc::downgrade(&state));
        Self { state, native_id }
    }

    #[napi(getter)]
    pub fn value(&self) -> i32 {
        self.state.value.load(Ordering::SeqCst)
    }

    #[napi(getter)]
    pub fn cpp_calls(&self) -> u32 {
        self.state.cpp_calls.load(Ordering::SeqCst)
    }

    #[napi]
    pub fn add(&self, delta: i32) -> napi::Result<i32> {
        self.state.add(delta).map_err(napi::Error::from_reason)
    }

    // Explicit transport for APIs which copy JS properties into LynxValue maps.
    #[napi]
    pub fn to_native_handle(&self) -> NativeCounterHandle {
        NativeCounterHandle {
            native_id: self.native_id.clone(),
        }
    }
}

impl Drop for RustCounter {
    fn drop(&mut self) {
        registry().lock().unwrap().remove(&self.native_id);
    }
}

pub struct CounterHandle {
    state: Arc<CounterState>,
}

fn acquire_counter(id: &str) -> Result<Box<CounterHandle>, String> {
    let state = registry()
        .lock()
        .unwrap()
        .get(id)
        .and_then(Weak::upgrade)
        .ok_or_else(|| format!("Unknown or released Rust counter: {id}"))?;
    Ok(Box::new(CounterHandle { state }))
}

impl CounterHandle {
    fn value(&self) -> i32 {
        self.state.value.load(Ordering::SeqCst)
    }

    fn cpp_calls(&self) -> u32 {
        self.state.cpp_calls.load(Ordering::SeqCst)
    }

    fn add_from_cpp(&self, delta: i32) -> Result<i32, String> {
        let value = self.state.add(delta)?;
        self.state.cpp_calls.fetch_add(1, Ordering::SeqCst);
        Ok(value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn js_and_cpp_handles_share_state_and_survive_wrapper_drop() {
        let object = RustCounter::new(10);
        let id = object.native_id.clone();
        object.add(2).unwrap();
        let cpp = acquire_counter(&id).unwrap();
        assert_eq!(cpp.add_from_cpp(5).unwrap(), 17);
        assert_eq!(object.value(), 17);
        assert_eq!(object.cpp_calls(), 1);
        drop(object);
        assert!(acquire_counter(&id).is_err());
        assert_eq!(cpp.add_from_cpp(1).unwrap(), 18);
    }

    #[test]
    fn invalid_handles_and_overflow_fail_without_mutation() {
        assert!(acquire_counter("invalid-id").is_err());
        let object = RustCounter::new(i32::MAX);
        let cpp = acquire_counter(&object.native_id).unwrap();
        assert!(cpp.add_from_cpp(1).is_err());
        assert_eq!(object.value(), i32::MAX);
        assert_eq!(object.cpp_calls(), 0);
    }

    #[test]
    fn handles_can_mutate_the_same_instance_from_multiple_threads() {
        let object = RustCounter::new(0);
        std::thread::scope(|scope| {
            for _ in 0..4 {
                let handle = acquire_counter(&object.native_id).unwrap();
                scope.spawn(move || {
                    for _ in 0..1000 {
                        handle.add_from_cpp(1).unwrap();
                    }
                });
            }
        });
        assert_eq!(object.value(), 4000);
        assert_eq!(object.cpp_calls(), 4000);
    }
}
