cmake_minimum_required(VERSION 3.18.1)
project(CatusNative LANGUAGES C CXX)

if(NOT APPLE)
  message(FATAL_ERROR "Catus native components currently implement macOS only.")
endif()
if(NOT DEFINED CXXBRIDGE_INCLUDE_DIR)
  message(FATAL_ERROR "Run pnpm run build:native; Rust build.rs supplies the cxx headers.")
endif()

get_filename_component(CATUS_NATIVE_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/.." ABSOLUTE)
find_program(NODE_EXECUTABLE node REQUIRED)
execute_process(
  COMMAND "${NODE_EXECUTABLE}" -p
    "require('node:path').dirname(require.resolve('@lynx-js/lynx-library-headers/package.json'))"
  WORKING_DIRECTORY "${CATUS_NATIVE_ROOT}"
  RESULT_VARIABLE HEADERS_RESULT
  OUTPUT_VARIABLE LYNX_HEADERS_ROOT
  ERROR_VARIABLE HEADERS_ERROR
  OUTPUT_STRIP_TRAILING_WHITESPACE
)
if(NOT HEADERS_RESULT EQUAL 0)
  message(FATAL_ERROR "Unable to resolve Lynx headers. Run pnpm install. ${HEADERS_ERROR}")
endif()

# All project components are compiled into one archive and one Node-API addon.
add_library(catus_native STATIC
  common/NativeTerminalRegistration.cc
  common/NativeFrameCallbacks.cc
)
if(APPLE)
  target_sources(catus_native PRIVATE platform/macos/NativeTerminalView.cc)
endif()
# Lynx C++ extension headers use Lynx's weak N-API bindings, as CEF does.
set_source_files_properties(common/NativeTerminalRegistration.cc PROPERTIES
  COMPILE_DEFINITIONS "USE_WEAK_SUFFIX_NAPI;NAPI_CPP_CUSTOM_NAMESPACE=weak_node_api"
)
target_compile_features(catus_native PRIVATE cxx_std_17)
target_include_directories(catus_native PRIVATE
  "${CMAKE_CURRENT_SOURCE_DIR}"
  "${LYNX_HEADERS_ROOT}/include"
  "${CXXBRIDGE_INCLUDE_DIR}"
)
set_target_properties(catus_native PROPERTIES
  POSITION_INDEPENDENT_CODE ON
  CXX_VISIBILITY_PRESET hidden
  VISIBILITY_INLINES_HIDDEN ON
  ARCHIVE_OUTPUT_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}/lib"
)
