#include <lynx/registration.h>

#include "NativeInputElement.h"

LYNX_REGISTER_ELEMENT(
    "CatusNativeInputElement",
    "native-input",
    CreateNativeInputElementNativeView,
    false,
    nullptr)
