# Catus Terminal — Lynxtron native 组件示例

使用官方 `@lynx-js/create-lynxtron@0.0.28` 初始化，使用官方
`create-lynx-library` 创建组件库，通过 AutoLink 加载 `<native-input>`。
当前组件实现针对 macOS，底层为真正可编辑的 AppKit `NSTextField`。

## 环境与运行

- Node.js：`^22.18.0 || ^24.0.0 || ^26.0.0`
- macOS + Xcode Command Line Tools（`xcode-select -p` 可检查）
- CMake ≥ 3.18.1
- Rust/Cargo（本项目使用 Rust 2024 edition；已验证 Rust 1.95.0）

```bash
npm install
npm run dev
```

`npm run dev` 和 `npm run build` 会先编译本地 native 库。
修改 TSX/CSS 会热更新；修改 C++/Objective-C++ 后需重启 `npm run dev`。

```bash
npm run build       # 原生库 + Lynx bundle + desktop 主进程
npm start           # 构建并运行
npm run typecheck   # UI、主进程及配置文件的 TypeScript 检查
npm test            # ReactLynx 交互测试
npm run test:rust   # Rust 生命周期/异常/多线程测试、fmt、clippy
npm run test:napi   # 实际 Node-API 扩展的构造、方法、句柄、异常测试
npm run pack        # 本机 macOS 应用打包，不发布
```

## 示例交互

- 在原生输入框键入文字，`bindinput` 将 `event.detail.value` 回传到 ReactLynx。
- **Update property**：通过 React 状态更新 `value` 属性。
- **Call setValue**：使用 SelectorQuery 调用 C++ `setValue` 方法。
- **Focus**：调用原生方法，将焦点移到 `NSTextField`。
- **Read value**：调用 `getValue`，显示原生组件内部的值。
- **Verify shared Rust object**：创建 napi-rs `RustCounter`，作为 `invoke.params.rustObject`
  传给 native view，C++ 通过 cxx 修改同一 Rust 实例，再从原始 JS 对象读取结果。

## Rust 对象与 native view

`native/native-input/rust` 使用 napi-rs 导出 `RustCounter` 类，使用 cxx 导出
opaque Rust `CounterHandle` 及其方法。napi-rs 驱动 Cargo 构建 Rust `cdylib`，
将 C++ view 静态库链接进同一个 `native-input.node`，保证进程内只有一个实例注册表。

```text
npm run build:native → lynxtron/build.mjs
  napi-rs CLI 调用 Cargo，生成 TypeScript 声明和 .node 文件
       ↓
rust/build.rs
  napi_build::setup() 配置 Node-API 动态链接
  cxx_build 生成桥接头文件和 C++ 桥接静态库
       ↓
lynxtron/CMakeLists.txt
  编译 C++ / Objective-C++ view → libcatus_native_views.a
       ↓
Cargo / Rust 链接器
  Rust cdylib + cxx 桥 + C++ 静态库 + AppKit 等系统 framework
  -force_load 保留 C++ 元素注册构造函数
       ↓
napi-rs CLI
  输出 dist/darwin/<arch>/native-input.node，生成 types/rust.d.ts
```

最终 Node-API 入口由 Rust 的 napi-rs 提供，不再需要 C++ `library_entry.cc`。
CMake 只负责 C++ 静态库，不负责最终 `.node` 链接；C++ 调用 Rust 仍通过 cxx。
`-force_load` 只用于 `cdylib`，Rust 测试可独立运行。`test:napi` 使用
`--no-default-features` 构建不含 Lynx view 的扩展，在 Node 中检查 napi-rs 导出；
组合扩展的组件注册和跨语言调用则在实际 Lynxtron 应用中验证。

```text
preload.ts
  new nativeBinding.RustCounter(10)，通过 contextBridge 导出工厂
       ↓
App.tsx / rustInterop.ts（Lynx 后台线程）
  counter.add(2) → 12；invoke.params = { rustObject: counter }
       ↓
NativeInputRust.cc / OnMethodInvoked
  参数转成 LynxValue map，读取 nativeId
       ↓
cxx → acquire_counter(nativeId)
  从注册表取得同一 Rust 状态的 Box<CounterHandle>
       ↓
CounterHandle::add_from_cpp(5)
  Rust 原子计数器 → 17
       ↓
原始 N-API counter.value
  读到 17，cppCalls = 1
```

**已在 macOS arm64 / Lynxtron 0.0.28 的实际桌面应用中验证通过。**
原始 N-API 实例的 `nativeId` 可以随方法参数到达 C++；其参数类型是
`lynx_value_map`（11）。本例用 ID 查找实例后通过 cxx 调用 Rust，未在
native view 中对 JS wrapper 执行 `napi_unwrap`，也未通过数字传递内存地址。
`add` 属性虽然存在，其值被转换成 `lynx_value_null`（0），不能从该参数直接
调用 JS 方法。完整实测数据保存在 [验证报告](docs/rust-interop-verification.json)。
另有 `counter.toNativeHandle()` 返回普通 `{ nativeId }` 对象，这条传参路径
也会在按钮验证中检查。

Rust 状态用 `Arc` 管理，注册表只存 `Weak`，native view 用 `rust::Box` 持有
共享状态。JS wrapper 回收会删除 ID；已绑定的 view 仍可安全调用，销毁 view
会释放其引用。未知或已释放的 ID 返回参数错误，不替换原有绑定。

Cargo 输出位于 `/tmp/catus-rust-<源码路径哈希>`，由
`scripts/rust-target.mjs` 统一计算；CMake 输出在 Cargo 的 `OUT_DIR/native-views` 中。
可用 `CATUS_RUST_TARGET_DIR` 环境变量覆盖为
项目外的绝对路径。cxx 在输出目录中创建指回源码的符号链接，因此 Rust 检查
通过 `npm run test:rust` 使用同一外部输出目录，避免 JS 构建/监听扫描目录循环。
修改 Rust/C++ 后重启 `npm run dev`。

## 代码位置

```text
src/app/App.tsx                         使用自定义标签，绑定事件、调用方法
src/main/desktop/main.ts                创建 LynxWindow
rsbuild.config.ts                      pluginLynxtron 启用 AutoLink
native/native-input/
  lynx.lib.json                        声明 macOS arm64/x64 原生产物
  types/index.d.ts                     自定义标签及事件的 TypeScript 类型
  lynxtron/index.cjs                    加载当前平台的 .node 文件
  lynxtron/build.mjs                    napi-rs 构建入口，输出扩展和 TypeScript 声明
  lynxtron/CMakeLists.txt               仅生成 C++ view 静态库
  shared/elements/
    NativeInputElementRegistration.cc  LYNX_REGISTER_ELEMENT 注册 native-input
    NativeInputElement.h               属性、事件、setValue/getValue/focus 方法
    NativeInputRust.cc                 检查参数、绑定实例、通过 cxx 调用 Rust
    backends/native-ui/macos/
      NativeInputElementNativeUI.mm    创建 NSTextField，布局与输入回调
  rust/src/lib.rs                      napi-rs 类、cxx 桥、共享状态和生命周期
  rust/build.rs                        生成 cxx 桥，构建并链接 C++ 静态库
src/app/rustInterop.ts                 在实际 native view 上执行跨语言验证
```

```text
npm run dev / build
  napi-rs → Cargo → build.rs/CMake，生成 native-input.node
       ↓
pluginLynxtron（rsbuild.config.ts）
  扫描 lynx.lib.json，复制原生库并注入加载代码
       ↓
lynxtron/index.cjs
  require(.node)，激活 LYNX_REGISTER_ELEMENT 静态注册
       ↓
App.tsx 渲染 <native-input>
  C++ 创建 NSTextField 并挂到当前 LynxView 的 renderer host
       ↓
OnPropertiesChanged / OnLayoutChanged
  更新原生属性与布局
       ↓
NSTextField 输入 → TriggerEvent("input") → bindinput → React 状态
```

原生库输出：`native/native-input/dist/darwin/<arch>/native-input.node`。
AutoLink 将它加载到桌面主进程并使标签可用于 Lynx runtime；UI 不应直接
import `@catus/native-input/lynxtron`。示例只使用该包的 TypeScript 类型。

Native UI 后端保留系统输入和 IME 行为。需要覆盖原生控件的 Lynx 内容时，
按官方文档使用 `<cover-view>`；普通 CSS `z-index` 无法可靠交错原生控件。
本例未实现 Windows、Linux 或 Web 后端。

## 官方文档

- [Lynxtron 入门](https://lynxjs.org/next/lynxtron/introduction.html)
- [Lynx Native Libraries](https://lynxjs.org/next/lynxtron/Native-Libraries/Lynx-Native-Libraries.html)
- [Custom Element — Desktop](https://lynxjs.org/next/guide/custom-native-component.html?platform=desktops)
- [Native Libraries and AutoLink](https://lynxjs.org/next/guide/autolink.html)
- [Node 与 Lynx 通信](https://lynxjs.org/next/lynxtron/learn/Communication-Between-Node-And-Lynx.html)
- [napi-rs classes](https://napi.rs/docs/concepts/class)
- [napi-rs CLI build](https://napi.rs/docs/cli/build)
- [napi-rs manual setup](https://napi.rs/docs/introduction/manual-setup)
- [cxx extern Rust](https://cxx.rs/extern-rust.html)
- [cxx Cargo build](https://cxx.rs/build/cargo.html)
