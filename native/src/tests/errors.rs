use super::*;

#[test]
fn napi_errors_preserve_context_and_underlying_causes() {
    let source = std::io::Error::from(std::io::ErrorKind::NotFound);
    let reason = source.to_string();
    let error = anyhow::Error::new(source)
        .context("Open PTY")
        .context("Create terminal");
    let error = napi_error(error);
    assert_eq!(error.reason, format!("Create terminal: Open PTY: {reason}"));
}
