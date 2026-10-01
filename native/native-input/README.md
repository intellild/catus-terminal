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
导入 `./lynxtron`。库的 Node-API 入口只负责加载，Lynx 元素使用
`LYNX_REGISTER_ELEMENT` 在 C++ 中静态注册。

源码编译依赖 `@lynx-js/lynx-library-headers` 与 `@lynx-js/weak-node-api`。
仅有 element 的库不需要 Native Module codegen。

详见项目根目录 [README](../../README.md) 和
[官方 Desktop custom element 文档](https://lynxjs.org/next/guide/custom-native-component.html?platform=desktops)。
