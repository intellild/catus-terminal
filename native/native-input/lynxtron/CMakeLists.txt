cmake_minimum_required(VERSION 3.18.1)
project(CatusNativeViews LANGUAGES C CXX)

if(NOT APPLE)
  message(FATAL_ERROR "This native-input example currently implements macOS only.")
endif()
if(NOT DEFINED CXXBRIDGE_INCLUDE_DIR)
  message(FATAL_ERROR "Run npm run build:native; Rust build.rs supplies the cxx headers.")
endif()

get_filename_component(LYNX_LIBRARY_PACKAGE_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/.." ABSOLUTE)
set(LYNX_NATIVE_ELEMENT_BACKEND "native-ui" CACHE STRING "" FORCE)
add_subdirectory("${LYNX_LIBRARY_PACKAGE_ROOT}/shared" "${CMAKE_CURRENT_BINARY_DIR}/shared")
target_include_directories(NativeInputAddonElements PRIVATE "${CXXBRIDGE_INCLUDE_DIR}")

# Only produce a C++ archive. Cargo owns the final Node-API module link.
add_library(catus_native_views STATIC $<TARGET_OBJECTS:NativeInputAddonElements>)
set_target_properties(catus_native_views PROPERTIES
  ARCHIVE_OUTPUT_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}/lib"
)
