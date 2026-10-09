fn main() {
    // AppKit requires the process main thread, so this test has no libtest harness.
    catus_native::run_native_input_tests();
}
