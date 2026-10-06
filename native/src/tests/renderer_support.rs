// All tests that deliberately invalidate the shared atlas must hold this lock.
pub(crate) static TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
