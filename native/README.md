# @catus/native

Catus Terminal 的 macOS 原生包，提供终端会话、`<native-terminal>` 组件和 SFTP 文件操作。

## 构建

在 macOS 上安装 Rust 工具链、CMake 和 Xcode Command Line Tools，然后在项目根目录运行以下命令。

```sh
pnpm install
pnpm build:native
```

当前架构的产物位于 `native/dist/darwin/<arch>/catus-native.node`。运行 `pnpm build` 可将它打包进桌面应用。

## 终端会话

在 preload 中通过 `@catus/native/lynxtron` 访问会话和 SFTP 接口。参数与返回类型见 [TypeScript 声明](index.d.ts)。

- `createTerminalSession(id, command?)` 创建会话。ID 必须是未占用的正整数，范围为 `1` 至 `2^32 − 1`。省略 `command` 时启动默认 shell。
- `writeTerminalSession(id, text)` 写入文本。`getTerminalSessionInfo(id)` 返回 shell、退出状态和终端文本。
- `getTmuxSessionInfo(id)` 查询 tmux 窗口。`selectTmuxWindow`、`createTmuxWindow` 和 `closeTmuxWindow` 用于切换、新建和关闭窗口。
- `closeTerminalSession(id)` 关闭终端，`detachTerminalSession(id)` 断开连接。关闭 tmux 标签页后，tmux 会话仍在主机上运行，可从会话菜单再次连接或结束会话。

## 终端组件

将 `<native-terminal>` 的 `terminal-id` 设为会话 ID 即可显示该会话，设为 `0` 可解除绑定。需要离屏渲染时可设置 `use-osr`。组件属性和滚动事件见[组件类型声明](elements.d.ts)。

| 组件方法 | 用途 |
| --- | --- |
| `focus()` | 获取键盘焦点 |
| `write({ text })`、`key({ key, control, alt })` | 发送文本或按键 |
| `getScrollState()`、`scrollTo({ sessionId, offset })` | 查询或设置滚动位置。偏移量以行为单位，`0` 表示底部 |
| `renderFrame()` | 请求绘制当前会话 |

拖动可选择文本，双击选词，三击选行。按住 Option 拖动可框选，按 Cmd+C 可复制。终端程序启用鼠标报告时，按住 Shift 仍可选择文本或滚动历史。

## SFTP

`connectSftp({ destination, port?, identityFile?, configFile? })` 返回 `Promise<SftpConnection>`。连接支持浏览目录、查询文件属性、读写文件、重命名和删除。文件内容使用 `Uint8Array`。操作完成后调用 `await connection.close()` 关闭连接。
