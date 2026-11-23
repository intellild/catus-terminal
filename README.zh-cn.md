# Catus Terminal

[English](README.md) | 简体中文

适用于 macOS 的桌面终端，支持本地和 SSH 会话、tmux 及 SFTP。

## 特性

- 在侧栏切换本地和 SSH 主机。切换后，每台主机的标签页和会话都会保留。
- 打开 tmux 标签页即可继续使用主机上已有的会话。角标显示会话数量，右键可连接、新建或关闭会话。终端标题栏可切换 tmux 窗口。
- 在 SFTP 面板浏览、上传和下载远程文件。
- 在 `~/.config/catus-terminal/config.json` 中配置主机、tmux 前缀和显示偏好。

## 开发

在 macOS 上构建需要 Node.js 22.18+/24/26、pnpm 和 Rust 工具链。

Turborepo 会先构建 `@catus/native`，再启动或构建桌面应用。各 Git 工作树的任务缓存独立保存在各自的 `.turbo/cache`，远程缓存已关闭。

```sh
pnpm install
pnpm dev          # 启动开发环境
pnpm build        # 构建桌面应用
pnpm start        # 构建并运行
pnpm tsc          # 类型检查
pnpm lint         # lint
pnpm test:unit    # UI 与 Node 单测
pnpm check:rust   # Rust fmt / clippy
pnpm test:e2e     # 运行时 E2E
```

`pnpm dev:web` 可启动 Web 预览。原生包的构建方法和公开接口见[原生包 README](native/README.md)。
