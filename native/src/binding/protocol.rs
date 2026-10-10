//! Names in the project's Lynx wire protocol. Application code uses enums;
//! only the binding adapters encode/decode the host's C strings.
use std::ffi::CStr;

macro_rules! protocol_names {
    ($name:ident { $($variant:ident => $wire:literal),+ $(,)? }) => {
        #[derive(Clone, Copy, Debug, PartialEq, Eq)]
        pub enum $name {
            $($variant,)+
        }
        impl $name {
            // Static storage also satisfies the host's registration lifetime.
            pub(super) fn as_cstr(self) -> &'static CStr {
                match self {
                    $(Self::$variant => $wire,)+
                }
            }
        }
    };
}

protocol_names!(ExtensionName {
    Terminal => c"CatusNativeTerminalElement",
});
protocol_names!(ElementName {
    Terminal => c"native-terminal",
});
protocol_names!(Event {
    ScrollChange => c"scrollchange",
});
// Element attributes, invoke parameters and event/result fields.
protocol_names!(Property {
    TerminalId => c"terminal-id",
    UseOsr => c"use-osr",
    SessionId => c"sessionId",
    Offset => c"offset",
    HistoryRows => c"historyRows",
    VisibleRows => c"visibleRows",
    Text => c"text",
    Key => c"key",
    Control => c"control",
    Alt => c"alt",
});

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Method {
    Focus,
    RenderFrame,
    ScrollTo,
    GetScrollState,
    Write,
    Key,
    /// Unrecognized host methods are answered with MethodNotFound.
    Unknown,
}
impl From<&CStr> for Method {
    fn from(name: &CStr) -> Self {
        match name.to_bytes() {
            b"focus" => Self::Focus,
            b"renderFrame" => Self::RenderFrame,
            b"scrollTo" => Self::ScrollTo,
            b"getScrollState" => Self::GetScrollState,
            b"write" => Self::Write,
            b"key" => Self::Key,
            _ => Self::Unknown,
        }
    }
}

#[cfg(test)]
#[path = "../tests/lynx_binding_protocol.rs"]
mod tests;
