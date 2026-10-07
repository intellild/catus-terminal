# Catus Terminal — Agent Guide

## Documentation

- Before working on Lynx or Lynxtron, read [llms.txt](https://lynxjs.org/llms.txt)
  and the relevant official documentation. Check installed SDK types for exact APIs.
- See [README.md](README.md) for application behavior and
  [native/README.md](native/README.md) for native architecture and interfaces.
- Before runtime debugging, load the official DevTool instructions:
  `pnpm exec agent-lynx skills get lynx-devtool` (or call `agent-lynx` directly
  if it is on PATH). If the first connection finds no clients, restart the
  DevTool-enabled app and run `agent-lynx list-clients` again.

## Project Layout

- `src/app/`: ReactLynx UI, shared UI components and Effect atom state.
- `src/main/desktop/`: Node.js host, preload and configuration persistence.
- `src/shared/` and `config/`: Shared schemas and bundled workspace defaults.
- `locales/`: TOML translation resources; currently English only.
- `native/`: Project-specific Rust/napi-rs crate with statically linked C++.
  Terminal computation, text rendering and platform adapters are separate modules;
  C++ follows the same shared/platform split. Native views currently support macOS.
- `tests/`: Runtime E2E, Node integration tests and fixtures. UI unit tests live
  alongside the app; Rust unit tests live under `native/src/tests/`.

## Development Conventions

### UI and State

- Use `@lynx-js/react`, Lynx elements and `bind*` events. Browser DOM/BOM APIs
  are unavailable; call preload capabilities through `NativeModules.nodejs.exposed`
  only in background-thread logic, never during render or in Main Thread Scripts.
- Keep the layout skeleton renderable on the main thread. Put business regions
  behind `background-only` boundaries with pure UI fallbacks; presentation
  components use type-only state imports to keep Effect out of the main bundle.
- Run business state and actions in the application-level Effect registry,
  independently of React. Hooks subscribe to region view atoms and dispatch
  commands; registry reset/dispose owns cancellation and resource cleanup.
- Compose layout and UI primitives through children, following shadcn conventions.
  Business components use wrappers in `src/app/components/ui/`, including the
  official Lynx UI Input and Popover, rather than importing Lynx UI directly.
- Use Tailwind utilities, `cn` when merging class lists and cva for variants.
  Use plain className strings or expressions when no merging is needed. Keep
  conditional classes as complete literals and runtime values in CSS variables.
  The stylesheet contains only Tailwind directives, without handwritten selectors.
- Keep native window-control spacing consistent with the tab bar. Interactive
  elements inside draggable regions must use `[-x-app-region:no-drag]`.
- Validate workspace configuration and save atomically. Never overwrite an
  invalid existing configuration file.
- Put UI copy in `locales/en.toml` and use i18next interpolation/plurals. Resources
  are compiled and initialized synchronously for both Lynx runtimes. Use
  `useTranslation()` in components so language changes rerender them; direct
  `i18n.t()` is for non-React logic. i18next v24 needs the Intl polyfill.

### Native Code

- Keep terminal/grid computation independent of GPU and OS APIs. Platform-specific
  Rust and C++ code belongs in their respective `platform/` directories; only
  platform adapters include OS headers or handle native surfaces.
- JS allocates numeric `u32` session IDs; Rust rejects duplicates and reserves 0
  for an unbound view. Atom actions own session creation/deletion. React mounting
  does not own sessions; tab/workspace closure and registry disposal release them.
- Keep the terminal view mounted when switching tabs or showing loading/errors.
  Switch content through `terminal-id`; derive viewport dimensions from native
  layout callbacks. Do not add custom width/height or active props, or remount
  the view through React keys.
- PTY threads only update grids. A single RAF adapter dispatches native callbacks
  on the UI thread; do not add frame queues, broadcasts or frame IDs. Do not hold
  callback registry locks while invoking callbacks.
- Drop expired or contended frames. Wait for submitted GPU work before returning
  borrowed Lynx buffers, and present only completed frames within their deadline.
- Share the GPU device and glyph atlas globally. Hold the shared glyph lock
  through upload, submission and GPU completion. Cache invalidation must affect
  all renderers; closing or rebinding a view must not clear the atlas.
- Use `anyhow::Result` with `?` / `Context` internally; convert to `napi::Result`
  only at N-API boundaries and preserve the full error chain.
- SFTP uses ordinary SSH pipes and napi's Tokio runtime. Close connections
  explicitly and retain drop cleanup. Before changing the callback API, consult
  the crash TODO in `native/src/sftp_api.rs`.
- Native components share one package. When adding components, update CMake
  sources, Lynx registration and element types. Do not hand-edit generated API types.

## Commands and Verification

Use pnpm and the Node.js versions declared in `package.json`.

| Task | Command |
| --- | --- |
| Install / develop | `pnpm install` / `pnpm dev` |
| Build application / native | `pnpm build` / `pnpm build:native` |
| TypeScript | `pnpm tsc` |
| Format / lint | `pnpm format:check` / `pnpm lint` |
| UI and Node unit tests | `pnpm test:unit` |
| Rust fmt, tests and clippy | `pnpm test:rust` |
| N-API integration tests | `pnpm test:napi` |
| Runtime E2E | `pnpm test:e2e` |

- Keep formatting/lint configuration in `rstack.config.ts`. TypeScript uses
  separate referenced projects for UI, desktop and tools; keep their types isolated.
- Runtime acceptance uses Rstest and Lynx DevTool DOM/Input plus
  `view.takeScreenshot`, not computer-use screenshots or OS UI observations.
- E2E defaults to windowless mode with isolated configuration and a fake PTY.
  Close existing Catus apps first. macOS Metal and an awake display are required;
  locked-screen/displayless CI is not verified.
- Screenshot baselines remain gitignored until the UI stabilizes. Generate/update
  them explicitly with `pnpm test:e2e:update` and inspect the images; never update
  baselines merely to hide a failure. Artifacts are under `.tmp/e2e/artifacts/`.
