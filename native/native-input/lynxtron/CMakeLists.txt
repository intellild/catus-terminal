cmake_minimum_required(VERSION 3.18.1)

project(NativeInputAddon LANGUAGES C CXX)

if(NOT APPLE)
  message(FATAL_ERROR "This native-input example currently implements macOS only.")
endif()

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)
set(CMAKE_C_VISIBILITY_PRESET hidden)
set(CMAKE_CXX_VISIBILITY_PRESET hidden)
set(CMAKE_OBJC_VISIBILITY_PRESET hidden)
set(CMAKE_OBJCXX_VISIBILITY_PRESET hidden)
set(CMAKE_VISIBILITY_INLINES_HIDDEN ON)

get_filename_component(
  LYNX_LIBRARY_PACKAGE_ROOT
  "${CMAKE_CURRENT_SOURCE_DIR}/.."
  ABSOLUTE
)

if(NOT DEFINED LYNX_LIBRARY_PLATFORM)
  if(CMAKE_SYSTEM_NAME STREQUAL "Darwin")
    set(LYNX_LIBRARY_PLATFORM "darwin")
  elseif(WIN32)
    set(LYNX_LIBRARY_PLATFORM "win32")
  elseif(CMAKE_SYSTEM_NAME STREQUAL "Linux")
    set(LYNX_LIBRARY_PLATFORM "linux")
  else()
    string(TOLOWER "${CMAKE_SYSTEM_NAME}" LYNX_LIBRARY_PLATFORM)
  endif()
endif()

if(NOT DEFINED LYNX_LIBRARY_ARCH)
  if(CMAKE_SYSTEM_PROCESSOR MATCHES "^(arm64|aarch64|AARCH64)$")
    set(LYNX_LIBRARY_ARCH "arm64")
  elseif(CMAKE_SYSTEM_PROCESSOR MATCHES "^(x86_64|AMD64|amd64)$")
    set(LYNX_LIBRARY_ARCH "x64")
  else()
    string(TOLOWER "${CMAKE_SYSTEM_PROCESSOR}" LYNX_LIBRARY_ARCH)
  endif()
endif()

set(
  LYNX_LIBRARY_OUTPUT_DIR
  "${LYNX_LIBRARY_PACKAGE_ROOT}/dist/${LYNX_LIBRARY_PLATFORM}/${LYNX_LIBRARY_ARCH}"
)
set(LYNX_LIBRARY_OUTPUT_NAME "native-input")

find_program(CARGO_EXECUTABLE cargo REQUIRED)
set(RUST_ROOT "${LYNX_LIBRARY_PACKAGE_ROOT}/rust")
# cxx-build links OUT_DIR/cxxbridge/crate back to the source directory. Keep
# outputs outside the project to avoid cycles in JS directory/watch scans.
string(SHA256 RUST_BUILD_KEY "${RUST_ROOT}")
string(SUBSTRING "${RUST_BUILD_KEY}" 0 12 RUST_BUILD_KEY)
if(NOT DEFINED CATUS_RUST_TARGET_DIR)
  if(DEFINED ENV{CATUS_RUST_TARGET_DIR} AND NOT "$ENV{CATUS_RUST_TARGET_DIR}" STREQUAL "")
    set(CATUS_RUST_TARGET_DIR "$ENV{CATUS_RUST_TARGET_DIR}")
  else()
    set(CATUS_RUST_TARGET_DIR "/tmp/catus-rust-${RUST_BUILD_KEY}")
  endif()
endif()
set(RUST_TARGET_DIR "${CATUS_RUST_TARGET_DIR}")
set(RUST_STATIC_LIBRARY "${RUST_TARGET_DIR}/release/libcatus_rust.a")
add_custom_command(
  OUTPUT "${RUST_STATIC_LIBRARY}"
  COMMAND "${CARGO_EXECUTABLE}" build --release --locked
          --manifest-path "${RUST_ROOT}/Cargo.toml" --target-dir "${RUST_TARGET_DIR}"
  DEPENDS "${RUST_ROOT}/Cargo.toml" "${RUST_ROOT}/Cargo.lock"
          "${RUST_ROOT}/build.rs" "${RUST_ROOT}/src/lib.rs"
  COMMENT "Building napi-rs addon and cxx bridge"
  VERBATIM
)
add_custom_target(CatusRust DEPENDS "${RUST_STATIC_LIBRARY}")

if(NOT DEFINED LYNX_LIBRARY_NODE_API_WEAK_SUFFIX)
  set(
    LYNX_LIBRARY_NODE_API_WEAK_SUFFIX
    ON
    CACHE BOOL
    "Use weak suffix NAPI symbols for shared native modules"
  )
endif()

set(
  LYNX_LIBRARY_USE_PRIMJS_NAPI_MODULE
  ON
  CACHE BOOL
  "Register standard Node-API modules through weak-node-api"
  FORCE
)
set(
  LYNX_LIBRARY_MANUAL_NAPI_REGISTRATION
  ON
  CACHE BOOL
  "Register standard Node-API modules from the Lynxtron entry"
  FORCE
)

add_subdirectory(
  "${LYNX_LIBRARY_PACKAGE_ROOT}/shared"
  "${CMAKE_CURRENT_BINARY_DIR}/shared"
)
add_dependencies(NativeInputAddonElements CatusRust)
target_include_directories(NativeInputAddonElements PRIVATE "${RUST_TARGET_DIR}/cxxbridge")

add_library(
  NativeInputAddon
  MODULE
  "${CMAKE_CURRENT_SOURCE_DIR}/library_entry.cc"
)

if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/generated_napi_registration.cc")
  target_sources(NativeInputAddon PRIVATE
    "${CMAKE_CURRENT_SOURCE_DIR}/generated_napi_registration.cc"
  )
  target_compile_definitions(NativeInputAddon PRIVATE
    LYNX_LIBRARY_HAS_NAPI_NATIVE_MODULES=1
  )
endif()

if(EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/generated_platform_registration.cc")
  target_sources(NativeInputAddon PRIVATE
    "${CMAKE_CURRENT_SOURCE_DIR}/generated_platform_registration.cc"
  )
  target_compile_definitions(NativeInputAddon PRIVATE
    LYNX_LIBRARY_HAS_PLATFORM_NATIVE_MODULES=1
  )
endif()

target_include_directories(NativeInputAddon PRIVATE
  "${LYNX_LIBRARY_PACKAGE_ROOT}"
)

target_link_libraries(NativeInputAddon PRIVATE
  ${LYNX_SHARED_TARGETS}
  ${LYNX_SHARED_PLATFORM_LINK_LIBRARIES}
)
add_dependencies(NativeInputAddon CatusRust)
# Keep napi-rs registration constructors, including otherwise unreferenced exports.
target_link_options(NativeInputAddon PRIVATE "-Wl,-force_load,${RUST_STATIC_LIBRARY}")
set_property(TARGET NativeInputAddon APPEND PROPERTY LINK_DEPENDS "${RUST_STATIC_LIBRARY}")

if(LYNX_SHARED_PLATFORM_COMPILE_DEFINITIONS)
  target_compile_definitions(NativeInputAddon PRIVATE
    ${LYNX_SHARED_PLATFORM_COMPILE_DEFINITIONS}
  )
endif()

if(LYNX_SHARED_PLATFORM_LINK_OPTIONS)
  target_link_options(NativeInputAddon PRIVATE
    ${LYNX_SHARED_PLATFORM_LINK_OPTIONS}
  )
endif()

set_target_properties(NativeInputAddon PROPERTIES
  OUTPUT_NAME "${LYNX_LIBRARY_OUTPUT_NAME}"
  PREFIX ""
  SUFFIX ".node"
  ARCHIVE_OUTPUT_DIRECTORY "${LYNX_LIBRARY_OUTPUT_DIR}"
  LIBRARY_OUTPUT_DIRECTORY "${LYNX_LIBRARY_OUTPUT_DIR}"
  RUNTIME_OUTPUT_DIRECTORY "${LYNX_LIBRARY_OUTPUT_DIR}"
  ARCHIVE_OUTPUT_DIRECTORY_DEBUG "${LYNX_LIBRARY_OUTPUT_DIR}"
  LIBRARY_OUTPUT_DIRECTORY_DEBUG "${LYNX_LIBRARY_OUTPUT_DIR}"
  RUNTIME_OUTPUT_DIRECTORY_DEBUG "${LYNX_LIBRARY_OUTPUT_DIR}"
  ARCHIVE_OUTPUT_DIRECTORY_RELEASE "${LYNX_LIBRARY_OUTPUT_DIR}"
  LIBRARY_OUTPUT_DIRECTORY_RELEASE "${LYNX_LIBRARY_OUTPUT_DIR}"
  RUNTIME_OUTPUT_DIRECTORY_RELEASE "${LYNX_LIBRARY_OUTPUT_DIR}"
)
