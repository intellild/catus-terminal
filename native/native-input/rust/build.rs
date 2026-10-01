use std::{env, path::PathBuf, process::Command};

fn run(command: &mut Command) {
    let status = command.status().expect("Failed to launch CMake");
    assert!(status.success(), "CMake failed: {command:?}");
}

fn main() {
    napi_build::setup();
    cxx_build::bridge("src/lib.rs")
        .std("c++17")
        .compile("catus-cxx-bridge");
    println!("cargo:rerun-if-changed=src/lib.rs");

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
    let package_root = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").unwrap())
        .parent()
        .unwrap()
        .to_owned();
    let out_dir = PathBuf::from(env::var_os("OUT_DIR").unwrap());
    let cpp_build = out_dir.join("native-views");
    run(Command::new("cmake")
        .arg("-S")
        .arg(package_root.join("lynxtron"))
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
        .arg("catus_native_views"));

    // Only the Node-API cdylib needs Lynx views. Keep their host-specific
    // symbols out of Rust unit-test executables and downstream rlib users.
    // force_load also retains the constructor-only registration object.
    println!(
        "cargo:rustc-cdylib-link-arg=-Wl,-force_load,{}",
        cpp_build.join("lib/libcatus_native_views.a").display()
    );
    for framework in [
        "AppKit",
        "CoreGraphics",
        "CoreText",
        "Foundation",
        "IOSurface",
    ] {
        println!("cargo:rustc-link-lib=framework={framework}");
    }
    for input in [
        "lynxtron/CMakeLists.txt",
        "shared/CMakeLists.txt",
        "shared/elements",
    ] {
        println!(
            "cargo:rerun-if-changed={}",
            package_root.join(input).display()
        );
    }
}
