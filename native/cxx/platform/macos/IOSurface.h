#pragma once
#include <IOSurface/IOSurfaceRef.h>
#include <type_traits>

namespace catus {
// Bridge the pointed-to opaque OS type, not the IOSurfaceRef pointer typedef.
using IOSurface = std::remove_pointer_t<IOSurfaceRef>;
}
