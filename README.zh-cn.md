# Catus Terminal

[English](README.md) | 简体中文

基于 [Lynxtron](https://lynxjs.org/lynxtron/) 的桌面终端。界面使用 Lynx，终端计算与渲染由 Rust 完成：Alacritty 解析 VT 序列，wgpu 绘制字符网格。

## 特性

- **多 host 切换**：本地与 SSH 主机并列在左侧 dock，点击即可切换；每个 host 保留自己的 terminal tabs，切换不会重建 session 或 native view。
- **内置 tmux**：tmux 是独立的 tab 类型，直接复用目标机器上已有的 session。角标显示 session 数量，右键可 attach、新建或关闭 session；terminal 标题栏显示并切换 tmux 窗口。
- **原生终端**：Rust 通过 portable-pty 管理进程，Alacritty 解析 VT/ANSI，wgpu 负责字符、光标和选区渲染，Lynxtron 负责窗口与资源加载。
- **SFTP**：SSH host 可以打开 SFTP 面板，浏览、上传和下载远程文件。
- **集中配置**：host、tmux 前缀和显示偏好保存在 `~/.config/catus-terminal/config.json`。

## 技术栈

| 层 | 实现 |
| --- | --- |
| 桌面壳 / UI | Lynxtron、Lynx、ReactLynx、Effect Atom |
| 终端计算 | Rust、portable-pty、Alacritty VT、napi-rs |
| 渲染 | wgpu、Metal、crossfont glyph atlas |
| 远程 | OpenSSH、tmux control mode、SFTP |

## 开发

要求 Node.js 22.18+/24/26、pnpm 和 Rust 工具链；原生视图目前只支持 macOS。

```sh
pnpm install
pnpm dev          # 启动开发环境
pnpm build        # 构建 native 与 JS bundle
pnpm start        # 构建并运行
pnpm tsc          # 类型检查
pnpm lint         # lint
pnpm test:unit    # UI 与 Node 单测
pnpm test:rust    # Rust fmt / test / clippy
pnpm test:e2e     # 运行时 E2E
```

`pnpm dev:web` 可启动不依赖 native 的 Web 预览。更深入的 native 架构与接口说明见 [native/README.md](native/README.md)。
