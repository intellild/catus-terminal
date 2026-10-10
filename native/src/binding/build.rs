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
    let header = include.join("capi/lynx_extension_module_capi.h");
    bindgen::Builder::default()
        .header(header.to_string_lossy())
        .header_contents("catus-lynx-env.h", "#include <capi/lynx_env_capi.h>")
        .header(include.join("capi/lynx_native_view_capi.h").to_string_lossy())
        // Invoke codes are only published as C++ class constants. Export their
        // SDK values to bindgen without duplicating numeric literals in Rust.
        .header_contents("catus-invoke-status.h", r#"
            #include <lynx_native_view.h>
            enum catus_invoke_status {
                catus_invoke_success = lynx::pub::LynxNativeView::kSuccess,
                catus_invoke_unknown = lynx::pub::LynxNativeView::kUnknown,
                catus_invoke_method_not_found = lynx::pub::LynxNativeView::kMethodNotFound,
                catus_invoke_invalid_parameter = lynx::pub::LynxNativeView::kInvalidParameter,
                catus_invoke_invalid_state = lynx::pub::LynxNativeView::kInvalidStateError,
            };
        "#)
        // The public C entry points include Lynx value headers that require
        // C++ syntax. Their extern "C" declarations still generate C ABI calls.
        .clang_args(["-x", "c++", "-std=c++17"])
        .clang_arg(format!("-I{}", include.display()))
        .allowlist_function(
            "lynx_extension_module_(create_with_finalizer|get_user_data|unref|bind_.*)",
        )
        .allowlist_function("lynx_env_register_extension_module")
        .allowlist_function("lynx_view_(register_native_view|get_native_window|register_ime_handler)")
        .allowlist_function("lynx_native_view_.*")
        .allowlist_function("lynx_value_(create_(bool|int64|string_utf8|map)|get_(number|bool|string_utf8|named_property)|set_named_property|add_reference|remove_reference)")
        .prepend_enum_name(false)
        .allowlist_type("lynx_extension_module_on_.*_func")
        .allowlist_type("lynx_native_mouse_button")
        .allowlist_type("catus_invoke_status")
        // Reuse napi-rs handles instead of generating incompatible Rust types
        // for the same opaque N-API pointers.
        .blocklist_type("napi_.*")
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
