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
