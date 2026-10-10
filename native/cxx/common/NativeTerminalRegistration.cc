#include <lynx/registration.h>

#include "platform/RustBridge.h"

// Keep the loader constructor in the cdylib-only archive. Rust owns extension
// registration/lifecycle; Rust unit-test executables never run this initializer.
LYNX_REGISTRATION_CONSTRUCTOR(RegisterTerminalExtension) { catus::register_terminal_extension(); }
