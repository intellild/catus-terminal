use anyhow::{Context, Result, ensure};
use std::{env, path::PathBuf};

#[path = "src/lynx_extension/build.rs"]
mod lynx_extension;
#[path = "src/platform/macos/build.rs"]
mod macos;

fn main() -> Result<()> {
    napi_build::setup();
    let native_view = env::var_os("CARGO_FEATURE_NATIVE_VIEW").is_some();
    // Pure Rust/N-API checks do not need a C++ bridge or Lynx host process.
    if !native_view {
        return Ok(());
    }
    ensure!(
        env::var("CARGO_CFG_TARGET_OS").context("Read target OS")? == "macos",
        "Native views currently require macOS"
    );
    // cxx-build tracks bridge sources; rustc tracks modules and include_str! shaders.
    cxx_build::bridges(macos::BRIDGES)
        .include("cxx")
        .std("c++17")
        .compile("catus-cxx-bridge");
    let package_root =
        PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").context("Read Cargo manifest directory")?);
    let out_dir = PathBuf::from(env::var_os("OUT_DIR").context("Read Cargo output directory")?);
    lynx_extension::generate(&package_root, &out_dir)?;
    macos::build_views(&package_root, &out_dir)?;
    // Cargo must rerun CMake when native sources or SDK dependency resolution change.
    for input in ["cxx", "package.json", "../pnpm-lock.yaml"] {
        println!(
            "cargo:rerun-if-changed={}",
            package_root.join(input).display()
        );
    }
    Ok(())
}
