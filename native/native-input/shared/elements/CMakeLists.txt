add_library(NativeInputAddonElements OBJECT
  NativeInputElement.cc
  NativeInputElementRegistration.cc
  NativeInputRust.cc
  backends/native-ui/macos/NativeInputElementNativeUI.mm
)

target_include_directories(NativeInputAddonElements PRIVATE
  "${CMAKE_CURRENT_SOURCE_DIR}/../.."
  "${LYNX_EXTENSION_HEADERS_DIR}/include"
)

set_source_files_properties(
  backends/native-ui/macos/NativeInputElementNativeUI.mm
  PROPERTIES COMPILE_FLAGS "-fobjc-arc"
)
