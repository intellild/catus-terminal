#pragma once

#if defined(__APPLE__)
#include "platform/macos/UiThread.h"
#else
#error "Catus native UI adapters currently implement macOS only"
#endif
