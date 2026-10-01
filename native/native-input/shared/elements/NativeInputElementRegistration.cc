#include <lynx/registration.h>

#include "shared/elements/NativeInputElement.h"

LYNX_REGISTER_ELEMENT(
    "NativeInputElementModule",
    "native-input",
    CreateNativeInputElementNativeView,
    false,
    nullptr)
