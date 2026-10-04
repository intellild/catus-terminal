# Lynxtron Application — Agent Guide

This document equips AI agents to author and modify code in this Lynxtron application quickly and safely. It explains the architecture, file layout, commands, and code patterns that work well with Lynx + NodeJS.

## Learning Resources

Read the docs below in advance to help you understand the library or frameworks this project depends on.

- Lynx and Lynxtron: [llms.txt](https://lynxjs.org/llms.txt).
  While dealing with a Lynx or Lynxtron task, an agent **MUST** read this document because it indexes the available documentation for both Lynx and Lynxtron.
- Runtime debugging: use the `agent-lynx` CLI to inspect and verify a running Lynx application. The CLI includes the official `lynx-devtool` skill; load its complete instructions before debugging:

  ```bash
  pnpm exec agent-lynx skills get lynx-devtool
  ```

  If `agent-lynx` is already available on `PATH`, omit the `pnpm dlx` prefix.

  If the session list is empty on the first CLI connection to a DevTool-enabled desktop app, **quit and restart the app**. The CLI enables DevTool when it connects, but existing windows need to be recreated. Run `agent-lynx list-clients` again after restarting and select the current client address.

- Default verification uses Lynx capabilities and Rstest automation. Use Lynx
  DevTool DOM/Input and `view.takeScreenshot`; do not use computer-use screenshots
  or OS UI observations as the acceptance baseline. Runtime E2E tests live in
  `tests/e2e`, with explicit PNG baselines and actual/diff artifacts. Never update
  baselines to make a failure disappear without inspecting the changed images.

## Overview

- Lynxtron is an Electron-like runtime where `BrowserWindow` is replaced by `LynxWindow`.
- UI is built with Lynx via ReactLynx (`@lynx-js/react`) using lowercase built-in elements such as `<view>`, `<text>`, `<image>`.
- **Native Module Model**: Desktop host capabilities are exposed to the UI through `NativeModules`.
  - `NativeModules.bridge`: Handles host-specific capabilities such as dialogs and window control via RPC.
  - `NativeModules.nodejs`: Provides a Node.js-like environment for background logic, injected directly into the Lynx Background Thread for maximum performance and object-level access.

## Project Layout

- `src/app`: Lynx UI layer built with ReactLynx
  - Entry: `src/app/index.tsx` renders `<App />` with `root.render`.
  - UI: `src/app/App.tsx` uses Lynx built-in elements and CSS.
  - State: `src/app/state/session.ts` uses Effect v4 atoms and official
    `@effect/atom-react` hooks. React imports are aliased to ReactLynx in build
    and tests. `components/AppLayout.tsx` exports named layout primitives composed
    with children in `App.tsx`, following shadcn-style composition rather than
    region slot props. These primitives render the static layout on the main
    thread; `App.tsx` puts separate `<background-only>` boundaries around tabs,
    workspace list, content, status and settings, each with a pure UI fallback.
    `state/SessionRegion.tsx` connects every region to the global `state/sessionRegistry.ts`;
    only its bootstrap region loads configuration. Presentation components
    must use type-only state imports to keep Effect out of the main-thread bundle.
    `runtime.ts` runs before Effect
    imports and installs Node codecs from preload factories in the isolated BTS
    global. Bridge functions are callable, not constructable; do not expose the
    Node codec classes directly as constructors.
  - Workspaces own tabs; first activation creates a tab, closing the last tab
    removes the dock indicator. Each tab owns a portable-pty default-shell session; switching tabs preserves it,
    closing tabs releases it. Workspace launch overrides are deferred.
  - `NativeDemo.tsx` preserves the native input / Rust object interoperability demonstration.
- `config/workspaces.json`: Bundled default profiles; `$SHELL` resolves the
  account's default shell. User settings live in `~/.config/catus-terminal/`.
- `src/shared/workspaces.ts`: Effect Schema validation and launch resolution.
- `src/main`: Host process logic
  - `src/main/desktop/`: Desktop (Node.js) host implementation.
    - `main.ts`: Main process entry (frameless window, native macOS traffic lights
      positioned in the UI tab bar). Keep the controls' reserved area consistent
      with the Tailwind classes in `App.tsx`; tabs and buttons must use
      `[-x-app-region:no-drag]`.
    - `preload.ts`: Logic injected into the Lynx thread (Node.js environment).
    - `workspaceConfig.ts`: Validated JSON load and atomic save; override path
      with `CATUS_WORKSPACES_FILE`. Never overwrite an invalid existing file.
- Config: `lynx.config.ts` (RSpeedy) and `rsbuild.config.ts` (Host builder).
- `native/`: Project-specific `@catus/native` workspace and Rust/napi-rs crate.
  - `src/lib.rs`: Rust exports and cxx bridge; `build.rs` builds and links native code.
  - `src/terminal_core/`: GPU-independent computation: portable-pty I/O threads,
    Alacritty streaming parser, owned display grid and basic key encoding.
    `src/terminal_view.rs` orchestrates resizing/snapshots and exposes the cxx bridge.
    `src/terminal_session.rs` owns the u32 registry and each session's renderer.
    `components/TerminalView.tsx` and its `NativeTerminalView` mount once for the
    content region. `state/session.ts` allocates numeric tab IDs (1..u32::MAX),
    used directly as session IDs. Rust accepts IDs and rejects duplicates and 0.
    `sessionAtom` writes reconcile Rust sessions through `state/terminalSessions.ts`
    before publishing state. Creation errors are atom state. React only observes
    IDs/errors; unmount/remount does not release sessions. Closing tabs/removing
    workspaces closes their sessions; registry disposal finalizes the remainder.
    Switching tabs only updates numeric `terminal-id`, with no view keys or active
    props. ID 0 unbinds the session while keeping the hidden native element mounted.
    TerminalContent must keep its children mounted across loading/config errors.
    `src/frame_clock.rs` owns native VSync scheduling and a process-wide LazyLock
    tokio broadcast channel. C++ calls register_frame_listener per native view;
    Rust retains receivers, active listener counts and runtime generations.
    PTY threads only update their own grid; VSync reads the latest grid and draws.
    `cxx/NativeTerminalRegistration.mm` passes the extension's observer to Rust.
    `cxx/NativeVSyncMonitorMacOS.mm` installs the SDK custom VSync monitor on macOS 14+:
    CADisplayLink must run on the UI main run loop; the current Lynxtron BTS loop
    does not drive the default macOS monitor. Older platforms keep the SDK fallback.
    `cxx/NativeFrameHost.mm` only bridges native BTS/UI task queues and surfaces:
    RAF registration/callback runs on BTS, UI rendering completes before renewal.
    ID 0, invalid layout, detach, background and destruction stop frame renewal.
    Queued callbacks retain weak clock/view references; stale generations cannot
    restart a replaced runtime. No JS RAF or per-frame invoke is used.
  - `src/renderer.rs`: one process-wide `LazyLock<Result<GpuContext, String>>`
    owns the shared device, queue and mutex-protected glyph resources. Each session
    owns an instance buffer and rendered grid key through its session. Hold the shared lock
    through atlas uploads, queue submission and GPU completion; rollback clears
    the atlas and changes its generation, invalidating every view. Closing or
    rebinding a view must never clear the global atlas.
    `src/frame.rs` defines the cxx `FrameBuffer` / `Viewport` descriptors.
    `cxx/NativeTerminalMacOS.mm` imports the borrowed Lynx IOSurface using the
    shared MTLDevice; wait for GPU completion before swapping buffers.
    Native terminal accepts only required numeric `terminal-id` and standard Lynx props.
    OnPropertiesChanged resolves that u32 ID to the session and its renderer.
    OnLayoutChanged computes the physical viewport and calls resize_viewport, which
    calculates columns/rows from font advance, line height/leading and padding.
    renderFrame only checks revision and draws; it does not resize the PTY;
    methods are focus/write/key/renderFrame. No prototype modes or render statistics.
  - `src/atlas.rs`: Alacritty shelf atlas port; staging-buffer rows must be aligned
    to 256 bytes. Clearing the atlas invalidates glyph handles via generation.
    `src/glyph_renderer.rs` / `src/atlas.wgsl` exercise uploads and instanced sampling
    with real crossfont glyphs. `src/font.rs` caches by font/character/size, uses
    Menlo regular/bold with CoreText fallback, and retains multiple physical pixel
    sizes simultaneously across views and DPI changes. Mask pages are R8Unorm; color pages are premultiplied RGBA8Unorm.
    Keep crossfont platform defaults; custom grayscale AA is deferred.
  - `src/tests/`: External unit-test modules for counter, atlas, fonts, terminal grids, PTYs and Metal rendering;
    attached as child modules so private implementation stays private.
  - `cxx/`: All C++ / Objective-C++ components and the single CMake target.
  - `build.mjs`: napi-rs CLI build entry; `index.cjs` and `lynx.lib.json` support AutoLink.
  - Register ordinary additional elements with unique module/tag names via `LYNX_REGISTER_ELEMENT`;
    terminal uses a custom extension module to receive the native VSync observer.
    add sources to `cxx/CMakeLists.txt` and types to `elements.d.ts`.

## Common Patterns

### Calling Native Capabilities
Use `NativeModules` to access capabilities exported by the desktop host.

```typescript
// Call a desktop host capability
NativeModules.bridge.call('showDialog', { message: 'Hi' }, () => {});

// Background logic (runs in the same JS thread as Lynx logic)
// Use exposed to access capabilities exported by host preload scripts
const result = NativeModules.nodejs.exposed.echo('Hello');
console.log(result);
```

JavaScript objects, including functions, are passed as-is without serialization.

## Commands

Use NodeJS ≥ 22 and TypeScript.

- Install: `pnpm install`
- Dev (Desktop): `pnpm run dev`
- Build (Desktop): `pnpm run build`
- Start (Desktop): `pnpm start`
- Test: `pnpm run test`
- Node test helpers: `pnpm run test:node` verifies the PNG comparator.
  `pnpm run test:unit` runs both ReactLynx and Node unit suites.
- E2E: `pnpm run test:e2e` builds and launches Lynxtron with an isolated config
  and the JS fake PTY at `tests/fixtures/fake-pty.mjs`. Defaults to Lynxtron
  `windowless: true`, `deviceScaleFactor: 2`; asserts a zero native window handle
  and never steals OS focus. `pnpm run test:e2e:windowed` runs the same suite
  with a native window. Each case owns its app
  process, uses the official daemon connector, and waits for native VSync pixels.
  It never calls `renderFrame`. Requires macOS Metal and the native display link;
  locked-screen/displayless CI is not verified. Unsupported
  platforms fail explicitly. Close any existing Catus app first.
  `pnpm run test:e2e:update` explicitly updates baseline PNGs; review them.
  Baselines live in `tests/e2e/__screenshots__/<platform>-<arch>/`; size changes
  fail. Baselines are temporarily gitignored until the UI stabilizes; a fresh
  checkout must run `pnpm run test:e2e:update` and inspect the generated images.
  Artifacts/logs are under `.tmp/e2e/artifacts/`. Runtime fixtures use
  `CATUS_E2E_PTY` / `CATUS_E2E_NODE` in preload, not workspace launch overrides.
  Rust `tests/terminal_rendering.rs` uses the same fake PTY and real Metal
  framebuffer import/readback to verify session rendering and idle revisions.
- TypeScript: `pnpm run tsc` (also `pnpm run typecheck`) runs `tsc --build`.
  Root `tsconfig.json` has `files: []` and references the UI, desktop and tools
  configs. Keep ReactLynx JSX in the UI project and Node types in desktop/tools.
  Subprojects use `composite` and `noEmit`, with separate build-info caches in
  ignored `.tmp/typecheck/`; shared sources are included by both runtime projects.
- Format all JS/TS: `pnpm format`; check with `pnpm format:check`.
- Lint all JS/TS: `pnpm lint`; apply safe fixes with `pnpm lint:fix`.
  Keep formatting and lint configuration in `rstack.config.ts`. Native builds
  format the generated `native/index.d.ts` before completing.

## Authoring UI (ReactLynx)

UI code in `src/app` runs in the Lynx engine, which is **not a browser**.

- **React-like but different**: Use `@lynx-js/react`.
- **Built-in Elements**: Use **lowercase** Lynx elements. DO NOT use HTML elements like `div`, `span`, `button`.
  - `<view>`: Container (like `div`).
  - `<text>`: Text (like `span`).
  - `<image>`: Image (like `img`).
  - `<scroll-view>`: Scrollable area.
  - `<list>`: High-performance list.
- **Event Model**: Standard Web events like `onClick` or `onChange` are NOT supported.
  - Use `bindtap` instead of `onClick`.
  - Use `bindinput` instead of `onChange`.
  - Events follow the pattern `bind<event_name>`.
- **CSS / Styling**:
  - Lynx uses a subset of CSS.
  - **Flexbox** is the primary layout engine (similar to React Native).
  - Use Tailwind v3 utility classes in `className`, with `@lynx-js/tailwind-preset`.
    `src/app/tailwind.css` contains only Tailwind directives; do not add handwritten
    CSS selectors. Keep conditional utilities as complete literal strings so
    Tailwind can scan them. Pass runtime colors and sizes through CSS variables.
  - No CSS selectors like `:hover`, `nth-child`, or complex combinators.
- **No DOM/BOM APIs**: `window`, `document`, `location`, `localStorage` are NOT available.
  - Use `NativeModules.bridge` for host interactions.
  - Use `NativeModules.nodejs` for background logic and data persistence.
- **Main vs Background**:
  - ReactLynx uses a dual-thread rendering model.
  - On the background thread, `NativeModules.nodejs` provides direct access to the APIs and JavaScript objects exposed by the Node.js preload, without serialization.
  - Use these APIs in background-thread event handlers or effects, not in component render code or Main Thread Scripts.

### UI Example

```tsx
import { useState, useCallback } from '@lynx-js/react';

export function MyComponent() {
  const [count, setCount] = useState(0);

  const handleTap = useCallback(() => {
    setCount(c => c + 1);
  }, []);

  return (
    <view className="flex flex-col items-center gap-[12px]">
      <text className="text-[24px] font-bold">Count: {count}</text>
      <view className="rounded-[8px] bg-[#a8e6cf] px-[16px] py-[10px]" bindtap={handleTap}>
        <text className="text-[14px] text-[#20392f]">Increment</text>
      </view>
    </view>
  );
}
```

## Local Type Definitions

Inspect local types for exact API surfaces:
- `node_modules/@lynx-js/lynxtron/apis/lynxtron.d.ts`
