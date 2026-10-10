//! Build-script-only bindings generated from the installed Lynx SDK.
use anyhow::{Context, Result, ensure};
use std::{path::Path, process::Command};

pub(crate) fn generate(package_root: &Path, out_dir: &Path) -> Result<()> {
    let output = Command::new("node")
        .args([
            "-p",
            "require('node:path').dirname(require.resolve('@lynx-js/lynx-library-headers/package.json'))",
        ])
        .current_dir(package_root)
        .output()
        .context("Resolve installed Lynx SDK headers")?;
    ensure!(
        output.status.success(),
        "Resolve Lynx SDK headers: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let sdk_root = String::from_utf8(output.stdout).context("Read Lynx SDK header path")?;
    let include = Path::new(sdk_root.trim()).join("include");
    bindgen::Builder::default()
        .header(package_root.join("src/binding/binding.h").to_string_lossy())
        // The public C entry points include Lynx value headers that require
        // C++ syntax. Their extern "C" declarations still generate C ABI calls.
        .clang_args(["-x", "c++", "-std=c++17"])
        .clang_arg(format!("-I{}", include.display()))
        // Include C API families rather than maintaining individual functions;
        // referenced callback/argument types are generated recursively.
        .allowlist_function("lynx_(extension_module|env|view|native_view|value)_.*")
        .prepend_enum_name(false)
        // These constant enums are not referenced by a function signature.
        .allowlist_type("lynx_native_mouse_button|catus_invoke_status")
        // Reuse napi-rs handles instead of generating incompatible Rust types
        // for the same opaque N-API pointers.
        .blocklist_type("napi_(env|value)")
        .layout_tests(false)
        .derive_debug(false)
        .rust_edition(bindgen::RustEdition::Edition2024)
        .parse_callbacks(Box::new(bindgen::CargoCallbacks::new()))
        .generate()
        .context("Generate Lynx C API bindings")?
        .write_to_file(out_dir.join("lynx_bindings.rs"))
        .context("Write Lynx C API bindings")?;
    Ok(())
}
