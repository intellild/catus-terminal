# Catus Terminal — Lynxtron native 组件示例

使用官方 `@lynx-js/create-lynxtron@0.0.28` 初始化，使用官方
`create-lynx-library` 创建组件库，通过 AutoLink 加载 `<native-input>`。
当前组件实现针对 macOS，底层为真正可编辑的 AppKit `NSTextField`。

## 环境与运行

- Node.js：`^22.18.0 || ^24.0.0 || ^26.0.0`
- macOS + Xcode Command Line Tools（`xcode-select -p` 可检查）
- CMake ≥ 3.18.1

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
npm run pack        # 本机 macOS 应用打包，不发布
```

## 示例交互

- 在原生输入框键入文字，`bindinput` 将 `event.detail.value` 回传到 ReactLynx。
- **Update property**：通过 React 状态更新 `value` 属性。
- **Call setValue**：使用 SelectorQuery 调用 C++ `setValue` 方法。
- **Focus**：调用原生方法，将焦点移到 `NSTextField`。
- **Read value**：调用 `getValue`，显示原生组件内部的值。

## 代码位置

```text
src/app/App.tsx                         使用自定义标签，绑定事件、调用方法
src/main/desktop/main.ts                创建 LynxWindow
rsbuild.config.ts                      pluginLynxtron 启用 AutoLink
native/native-input/
  lynx.lib.json                        声明 macOS arm64/x64 原生产物
  types/index.d.ts                     自定义标签及事件的 TypeScript 类型
  lynxtron/index.cjs                    加载当前平台的 .node 文件
  shared/elements/
    NativeInputElementRegistration.cc  LYNX_REGISTER_ELEMENT 注册 native-input
    NativeInputElement.h               属性、事件、setValue/getValue/focus 方法
    backends/native-ui/macos/
      NativeInputElementNativeUI.mm    创建 NSTextField，布局与输入回调
```

```text
npm run dev / build
  CMake 编译 native-input.node
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
