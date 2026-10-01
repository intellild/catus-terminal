// napi-rs supplies napi_register_module_v1 from the Rust static library.
// CMake links it into the same .node as the statically registered Lynx views.
// This keeps one Rust registry shared by Node.js and the C++ view instances.
