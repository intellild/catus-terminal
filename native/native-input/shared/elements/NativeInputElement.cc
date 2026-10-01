#include "shared/elements/NativeInputElement.h"

lynx_native_view_t* CreateNativeInputElementNativeUINativeView(void* opaque);

lynx_native_view_t* CreateNativeInputElementNativeView(void* opaque) {
  return CreateNativeInputElementNativeUINativeView(opaque);
}
