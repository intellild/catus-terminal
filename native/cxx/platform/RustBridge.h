#pragma once

#if defined(__APPLE__)
#include "catus-native/src/platform/macos/frame.rs.h"
#include "catus-native/src/platform/macos/terminal.rs.h"
#else
#error "Catus native Rust bridges currently implement macOS only"
#endif
