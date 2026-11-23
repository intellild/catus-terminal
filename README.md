# Catus Terminal

English | [简体中文](README.zh-cn.md)

A desktop terminal for macOS with local and SSH sessions, tmux and SFTP.

## Features

- Switch between local and SSH hosts in the sidebar. Each host keeps its tabs and sessions open when you switch.
- Open a tmux tab to resume a session on the host. The badge shows the session count. Right-click to attach to, create or close a session. Switch tmux windows from the terminal header.
- Browse, upload and download remote files in the SFTP panel.
- Configure hosts, tmux prefixes and display preferences in `~/.config/catus-terminal/config.json`.

## Development

Building on macOS requires Node.js 22.18+/24/26, pnpm and a Rust toolchain.

Turborepo builds `@catus/native` before starting or bundling the desktop app. Each Git worktree keeps its own local task cache in `.turbo/cache`. Remote caching is disabled.

```sh
pnpm install
pnpm dev          # start the dev environment
pnpm build        # build the desktop app
pnpm start        # build and run
pnpm tsc          # type-check
pnpm lint         # lint
pnpm test:unit    # UI and Node unit tests
pnpm check:rust   # Rust fmt / clippy
pnpm test:e2e     # runtime E2E
```

`pnpm dev:web` starts a web preview. For native package build instructions and public interfaces, see the [native package README](native/README.md).
