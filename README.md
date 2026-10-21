# Catus Terminal

English | [简体中文](README.zh-cn.md)

A desktop terminal built on [Lynxtron](https://lynxjs.org/lynxtron/). The UI is built with Lynx, while terminal computation and rendering are implemented natively in Rust with wgpu for high performance and low memory use: Alacritty parses VT sequences and wgpu draws the character grid directly.

## Features

- **Multiple hosts**: local and SSH hosts sit in the left dock; click to switch. Each host keeps its own terminal tabs, and switching preserves sessions and the mounted native view.
- **Built-in tmux**: tmux is a first-class tab kind that reuses sessions already running on the target machine. A badge shows the session count, right-click to attach, create or close sessions, and the terminal header lists and switches tmux windows.
- **Native terminal**: Rust drives processes through portable-pty, Alacritty handles VT/ANSI parsing, wgpu renders glyphs, cursor and selection, and Lynxtron owns the window and asset loading.
- **SFTP**: SSH hosts can open an SFTP panel to browse, upload and download remote files.
- **Single config**: hosts, tmux prefixes and display preferences live in `~/.config/catus-terminal/config.json`.

## Development

Requires Node.js 22.18+/24/26, pnpm and a Rust toolchain. The native view currently supports macOS only.

```sh
pnpm install
pnpm dev          # start the dev environment
pnpm build        # build native and JS bundles
pnpm start        # build and run
pnpm tsc          # type-check
pnpm lint         # lint
pnpm test:unit    # UI and Node unit tests
pnpm test:rust    # Rust fmt / test / clippy
pnpm test:e2e     # runtime E2E
```

`pnpm dev:web` starts a Web preview that does not need the native addon. See [native/README.md](native/README.md) for the native architecture and interfaces.
