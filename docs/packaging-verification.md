# macOS 打包与原生终端验证

2026-10-12，macOS arm64，Lynxtron / Lynxtron Builder 0.0.28。

## 原生模块路径

```text
native/build.mjs
  构建 native/dist/darwin/arm64/catus-native.node
       ↓
rsbuild.config.ts → pluginLynxtron AutoLink
  暂存 dist/desktop/.lynxtron/native/node_modules/@catus/native/
       ↓
lynxtron-builder
  放入 Catus Terminal.app/Contents/Resources/
       app.asar.unpacked/.lynxtron/native/node_modules/@catus/native/
       ↓
AutoLink registration / preload proxy
  按应用路径解析 @catus/native/lynxtron → index.cjs
       ↓
lynx.lib.json
  加载 dist/darwin/arm64/catus-native.node
```

应用包含原生包的 `package.json`、`lynx.lib.json`、`index.cjs` 和目标平台的 `.node`。
AutoLink 包保持在 ASAR 外；主进程注册与 preload 使用同一套暂存路径。
应用不需要包含 Rust/C++ 源码目录。

## 终端空白调查

使用单独的 DevTool 打包副本、隔离的 workspace 配置和 fake PTY 验证：

- preload 已暴露 `createTerminalSession`、`dispatchAnimationFrame` 等原生能力。
- DOM 中 `native-terminal#terminal-surface` 绑定 `terminal-id=1`。
- 原生 session 的 PTY 存活，网格包含 `FAKE PTY READY`，布局为 124 列、37 行。
- 普通窗口的 AppKit view 已挂载、关联窗口、未隐藏，Metal 显式绘制成功。
- windowless 模式通过 `view.takeScreenshot` 捕获到真实终端文字、颜色与 emoji。
  普通窗口的 AppKit 子视图不包含在 Lynx surface 截图内，不能用其空白截图判断模块缺失。

调查时 CoreGraphics 报告 `CGDisplayIsAsleep(1) == true`，活动显示器数量为 0；
普通窗口的自动 native 帧计数为 0。短暂唤醒显示器后，报告变为显示器未休眠、
活动显示器数量为 1，自动 native 帧计数恢复到 7,276。
通过 native view 写入 `update\r` 后，PTY 网格更新为 `FAKE PTY UPDATED`，
验证期间没有依靠显式 `renderFrame` 驱动这次输出更新。

上述结果确认打包副本能加载原生模块；本次空白现象的环境因素是显示器休眠导致
普通窗口的 MTS RAF 停止。所有临时 JS/Rust 诊断代码已撤销，正式产物重新使用
release runtime 构建；没有增加计时器、帧队列或模块手动复制规则。
