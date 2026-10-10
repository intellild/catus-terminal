use super::*;

#[test]
fn method_decoding_rejects_partial_case_changed_and_invalid_utf8_names() {
    assert_eq!(Method::from(c"scrollTo"), Method::ScrollTo);
    assert_eq!(Method::from(c"getScrollState"), Method::GetScrollState);
    for name in [c"", c"scroll", c"scrollToExtra", c"ScrollTo", c"\xff"] {
        assert_eq!(Method::from(name), Method::Unknown);
    }
}
