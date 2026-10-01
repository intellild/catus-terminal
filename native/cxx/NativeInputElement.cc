#include "NativeInputElement.h"

lynx_native_view_t* CreateNativeInputMacOSView(void* opaque);

lynx_native_view_t* CreateNativeInputElementNativeView(void* opaque) {
  return CreateNativeInputMacOSView(opaque);
}
