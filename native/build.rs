use std::{env, path::PathBuf, process::Command};

fn run(command: &mut Command) {
    let status = command.status().expect("Failed to launch CMake");
    assert!(status.success(), "CMake failed: {command:?}");
}

fn main() {
    napi_build::setup();
    let mut bridges = vec!["src/lib.rs"];
    if env::var_os("CARGO_FEATURE_NATIVE_VIEW").is_some() {
        bridges.push("src/terminal_view.rs");
    }
    // cxx-build tracks the bridge sources; rustc tracks modules and include_str! shaders.
    cxx_build::bridges(bridges)
        .std("c++17")
        .compile("catus-cxx-bridge");

    // Pure Rust/N-API checks can run without a Lynx host process.
    if env::var_os("CARGO_FEATURE_NATIVE_VIEW").is_none() {
        return;
    }
    assert_eq!(env::var("CARGO_CFG_TARGET_OS").unwrap(), "macos");
    let arch = match env::var("CARGO_CFG_TARGET_ARCH").unwrap().as_str() {
        "aarch64" => "arm64",
        "x86_64" => "x86_64",
        other => panic!("Unsupported native view architecture: {other}"),
    };
    let package_root = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").unwrap());
    let out_dir = PathBuf::from(env::var_os("OUT_DIR").unwrap());
    let cpp_build = out_dir.join("cxx");
    run(Command::new("cmake")
        .arg("-S")
        .arg(package_root.join("cxx"))
        .arg("-B")
        .arg(&cpp_build)
        .arg("-DCMAKE_BUILD_TYPE=Release")
        .arg(format!("-DCMAKE_OSX_ARCHITECTURES={arch}"))
        .arg(format!(
            "-DCXXBRIDGE_INCLUDE_DIR={}",
            out_dir.join("cxxbridge/include").display()
        )));
    run(Command::new("cmake")
        .arg("--build")
        .arg(&cpp_build)
        .arg("--config")
        .arg("Release")
        .arg("--target")
        .arg("catus_native"));

    // Only the Node-API cdylib needs Lynx views. Keep their host-specific
    // symbols out of Rust unit-test executables and downstream rlib users.
    // force_load also retains the constructor-only registration object.
    println!(
        "cargo:rustc-cdylib-link-arg=-Wl,-force_load,{}",
        cpp_build.join("lib/libcatus_native.a").display()
    );
    for framework in [
        "AppKit",
        "CoreGraphics",
        "CoreText",
        "Foundation",
        "IOSurface",
        "Metal",
    ] {
        println!("cargo:rustc-link-lib=framework={framework}");
    }
    // Cargo must rerun CMake when native sources or SDK dependency resolution change.
    for input in ["cxx", "package.json", "../pnpm-lock.yaml"] {
        println!(
            "cargo:rerun-if-changed={}",
            package_root.join(input).display()
        );
    }
}
