# @catus/native

Catus Terminal 专属的 Rust/napi-rs workspace，统一导出 Rust 能力和 Lynx native
组件。包名为 `@catus/native`，所有组件链接进同一个 `catus-native.node`。
当前实现 `<native-input>`，后端为 macOS `NSTextField`。

```text
native/
  Cargo.toml / Cargo.lock       Rust crate 和依赖
  build.rs                     cxx 桥、C++ 静态库构建及链接
  src/lib.rs                   napi-rs 导出和共享 Rust 状态
  cxx/
    CMakeLists.txt             项目 C++ 静态库的源文件清单
    NativeInputElement*.cc/h   输入组件及宏注册
    NativeInputRust.cc         C++ → Rust 调用
    NativeInputMacOS.mm        AppKit 输入框实现
  package.json / build.mjs      napi-rs 构建入口
  lynx.lib.json / index.cjs     AutoLink 产物描述与加载
  index.d.ts                   napi-rs 自动生成的 Rust API 类型
  elements.d.ts                Lynx 组件类型
  index.d.cts                  公共类型入口
```

新增组件时把 C++ 文件加入 `cxx/CMakeLists.txt` 的 `catus_native` target，
在源码中调用 `LYNX_REGISTER_ELEMENT`，并在 `elements.d.ts` 声明标签类型。
每个组件使用唯一的 extension module 名称和标签；如当前组件使用
`CatusNativeInputElement` / `native-input`。宏为各组件生成独立注册构造函数，
同一 `.node` 可以包含多个这样的注册，无需为每个组件创建 npm 包或 Rust crate。

## API

| 类型 | 名称 | 说明 |
| --- | --- | --- |
| 属性 | `value: string` | 更新 NSTextField 的文本 |
| 属性 | `placeholder: string` | 输入框占位文字 |
| 事件 | `bindinput` | 用户编辑时回传 `{ detail: { value: string } }` |
| 方法 | `setValue({ value: string })` | 设置文本，不发出用户输入事件 |
| 方法 | `getValue({})` | 返回当前文本字符串 |
| 方法 | `focus({})` | 获取输入焦点 |
| 方法 | `inspectRustObject({ rustObject })` | 返回收到的 LynxValue 类型、nativeId、add 属性信息 |
| 方法 | `bindRustCounter({ rustObject })` | 接受 RustCounter 或 `{ nativeId }`，取得共享 Rust 句柄 |
| 方法 | `addRustCounter({ delta: number })` | C++ 通过 cxx 调用 Rust；返回 `{ nativeId, value, cppCalls }` |

通过 `lynx.createSelectorQuery().select('#id').invoke({...}).exec()` 调用方法。
返回状态码使用 `LynxNativeView` 常量：成功 0、未知方法 3、参数错误 4、
无法获取焦点 7。

原生侧用户输入只更新内部值并发出 `input` 事件。React 将相同文本写回时，
不会重设 NSTextField 的值，避免破坏当前选择和输入法标记文本。

## 构建与加载

在项目根目录运行：

```bash
npm install
npm run build:native
```

产物为 `dist/darwin/<arch>/catus-native.node`。`lynx.lib.json` 声明 macOS
arm64/x64，但每次构建只生成当前架构产物。当前已验证 macOS arm64。

主应用的 `pluginLynxtron()` 自动扫描、复制和加载本库；不要从 UI 运行时代码
导入 `./lynxtron`。preload 可以通过其默认导出访问 napi-rs 的 `RustCounter` 类。
库的 Node-API 入口由 Rust 提供，Lynx 元素使用
`LYNX_REGISTER_ELEMENT` 在 C++ 中静态注册。

源码编译依赖 `@lynx-js/lynx-library-headers`，CMake 直接读取已安装的 SDK 头文件。

Rust 扩展与 C++ 元素链接为同一个 `.node`，cxx 生成类型安全的 C++ 头文件。
`RustCounter` 的 N-API wrapper 与 `CounterHandle` 共享 `Arc<CounterState>`。
传入 native view 时使用 `nativeId` 定位状态，不把地址暴露到 JS。

构建入口是 `build.mjs`，通过官方 `@napi-rs/cli` 调用 Cargo，输出
`.node` 和自动生成的 `index.d.ts`。`build.rs` 先用 `cxx-build` 生成
桥接代码，再调用 CMake 构建 `libcatus_native.a`；Rust `cdylib` 最后链接
该静态库、cxx 桥和系统 framework。CMake 不再构建动态库，Node-API 入口由
Rust napi-rs 提供。

macOS 链接参数 `-force_load` 保留 C++ 的 `LYNX_REGISTER_ELEMENT` 注册构造函数，
仅应用于 Cargo 的 `cdylib` 目标。`native-view` 是默认 feature；关闭它可构建
不含 Lynx view 的 Rust 扩展，供独立 Node 进程执行 N-API 测试。实际组合扩展
通过 AutoLink 加载，组件注册及 C++ → Rust 调用在 Lynxtron 中验证。

release profile 显式使用 `strip = "none"`，避免当前 Rust 1.95 / LLVM 在 macOS 27
上 strip 产生无效 LINKEDIT 的问题（[Rust issue #157750](https://github.com/rust-lang/rust/issues/157750)）。

```ts
// preload
import nativeBinding from '@catus/native/lynxtron';
const counter = new nativeBinding.RustCounter(10);
// 在 Lynx 后台线程通过 SelectorQuery 调用：
// bindRustCounter({ rustObject: counter })
// 或 bindRustCounter({ rustObject: counter.toNativeHandle() })
// addRustCounter({ delta: 5 })
```

调用 `addRustCounter` 前需绑定实例；未绑定返回状态 7，非法 ID、非 int32 的
delta、Rust 整数溢出返回状态 4。绑定失败会保留前一个有效实例。
N-API JS 对象不是 native view 的 napi_value 参数；本例的调用桥梁是 ID + cxx。

详见项目根目录 [README](../README.md) 和
[官方 Desktop custom element 文档](https://lynxjs.org/next/guide/custom-native-component.html?platform=desktops)。
