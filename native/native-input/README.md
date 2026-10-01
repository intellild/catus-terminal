# @catus/native-input

通过官方 `create-lynx-library --features element --platforms lynxtron` 生成，
实现 macOS Native UI 后端。该本地 workspace 为主应用提供 `<native-input>`。

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

产物为 `dist/darwin/<arch>/native-input.node`。`lynx.lib.json` 声明 macOS
arm64/x64，但每次构建只生成当前架构产物。当前已验证 macOS arm64。

主应用的 `pluginLynxtron()` 自动扫描、复制和加载本库；不要从 UI 运行时代码
导入 `./lynxtron`。preload 可以通过其默认导出访问 napi-rs 的 `RustCounter` 类。
库的 Node-API 入口由 Rust 提供，Lynx 元素使用
`LYNX_REGISTER_ELEMENT` 在 C++ 中静态注册。

源码编译依赖 `@lynx-js/lynx-library-headers` 与 `@lynx-js/weak-node-api`。
仅有 element 的库不需要 Native Module codegen。

Rust 扩展与 C++ 元素链接为同一个 `.node`，cxx 生成类型安全的 C++ 头文件。
`RustCounter` 的 N-API wrapper 与 `CounterHandle` 共享 `Arc<CounterState>`。
传入 native view 时使用 `nativeId` 定位状态，不把地址暴露到 JS。
Rust 静态库使用 `-force_load` 链接，保留 napi-rs 导出注册；仅应用内组合产物
通过 AutoLink 加载。测试脚本在独立 Node 进程中链接和加载单独的 Rust `.node`。

```ts
// preload
import nativeBinding from '@catus/native-input/lynxtron';
const counter = new nativeBinding.RustCounter(10);
// 在 Lynx 后台线程通过 SelectorQuery 调用：
// bindRustCounter({ rustObject: counter })
// 或 bindRustCounter({ rustObject: counter.toNativeHandle() })
// addRustCounter({ delta: 5 })
```

调用 `addRustCounter` 前需绑定实例；未绑定返回状态 7，非法 ID、非 int32 的
delta、Rust 整数溢出返回状态 4。绑定失败会保留前一个有效实例。
N-API JS 对象不是 native view 的 napi_value 参数；本例的调用桥梁是 ID + cxx。

详见项目根目录 [README](../../README.md) 和
[官方 Desktop custom element 文档](https://lynxjs.org/next/guide/custom-native-component.html?platform=desktops)。
