//! Build-script-only macOS C++ compilation and framework linking.
use anyhow::{Context, Result, bail, ensure};
use std::{env, path::Path, process::Command};

pub(crate) const BRIDGES: &[&str] = &[
    "src/frame.rs",
    "src/platform/macos/frame.rs",
    "src/platform/macos/terminal.rs",
];

fn run(command: &mut Command) -> Result<()> {
    let status = command
        .status()
        .with_context(|| format!("Launch CMake: {command:?}"))?;
    ensure!(status.success(), "CMake failed ({status}): {command:?}");
    Ok(())
}

pub(crate) fn build_views(package_root: &Path, out_dir: &Path) -> Result<()> {
    let arch = match env::var("CARGO_CFG_TARGET_ARCH")
        .context("Read target architecture")?
        .as_str()
    {
        "aarch64" => "arm64",
        "x86_64" => "x86_64",
        other => bail!("Unsupported native view architecture: {other}"),
    };
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
        )))?;
    run(Command::new("cmake")
        .arg("--build")
        .arg(&cpp_build)
        .arg("--config")
        .arg("Release")
        .arg("--target")
        .arg("catus_native"))?;

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
        "QuartzCore",
    ] {
        println!("cargo:rustc-link-lib=framework={framework}");
    }
    Ok(())
}
