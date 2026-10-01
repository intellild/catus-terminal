fn main() {
    // CMake performs the final .node link; napi-rs supplies its N-API entry
    // and registration constructors in the Rust static library.
    cxx_build::bridge("src/lib.rs")
        .std("c++17")
        .compile("catus-cxx-bridge");
    println!("cargo:rerun-if-changed=src/lib.rs");
}
