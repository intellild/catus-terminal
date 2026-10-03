# Lynxtron Application — Agent Guide

This document equips AI agents to author and modify code in this Lynxtron application quickly and safely. It explains the architecture, file layout, commands, and code patterns that work well with Lynx + NodeJS.

## Learning Resources

Read the docs below in advance to help you understand the library or frameworks this project depends on.

- Lynx and Lynxtron: [llms.txt](https://lynxjs.org/llms.txt).
  While dealing with a Lynx or Lynxtron task, an agent **MUST** read this document because it indexes the available documentation for both Lynx and Lynxtron.
- Runtime debugging: use the `agent-lynx` CLI to inspect and verify a running Lynx application. The CLI includes the official `lynx-devtool` skill; load its complete instructions before debugging:

  ```bash
  pnpm dlx agent-lynx skills get lynx-devtool
  ```

  If `agent-lynx` is already available on `PATH`, omit the `pnpm dlx` prefix.

  If the session list is empty on the first CLI connection to a DevTool-enabled desktop app, **quit and restart the app**. The CLI enables DevTool when it connects, but existing windows need to be recreated. Run `agent-lynx list-clients` again after restarting and select the current client address.

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
    `state/SessionRegion.tsx` shares one registry per App across those regions;
    only its bootstrap region loads configuration. Presentation components
    must use type-only state imports to keep Effect out of the main-thread bundle.
    `runtime.ts` runs before Effect
    imports and installs Node codecs from preload factories in the isolated BTS
    global. Bridge functions are callable, not constructable; do not expose the
    Node codec classes directly as constructors.
  - Workspaces own tabs; first activation creates a tab, closing the last tab
    removes the dock indicator. Terminal content is a placeholder; no PTY yet.
  - `NativeDemo.tsx` preserves the original native rendering demonstration.
- `config/workspaces.json`: Bundled default profiles; `$SHELL` resolves the
  account's default shell. User settings live in `~/.config/catus-terminal/`.
- `src/shared/workspaces.ts`: Effect Schema validation and launch resolution.
- `src/main`: Host process logic
  - `src/main/desktop/`: Desktop (Node.js) host implementation.
    - `main.ts`: Main process entry (frameless window, native macOS traffic lights
      positioned in the UI tab bar). Keep the controls' reserved area consistent
      with `App.css`; tabs and buttons must be `-x-app-region: no-drag`.
    - `preload.ts`: Logic injected into the Lynx thread (Node.js environment).
    - `workspaceConfig.ts`: Validated JSON load and atomic save; override path
      with `CATUS_WORKSPACES_FILE`. Never overwrite an invalid existing file.
- Config: `lynx.config.ts` (RSpeedy) and `rsbuild.config.ts` (Host builder).
- `native/`: Project-specific `@catus/native` workspace and Rust/napi-rs crate.
  - `src/lib.rs`: Rust exports and cxx bridge; `build.rs` builds and links native code.
  - `src/terminal.rs` / `src/triangle.wgsl`: macOS wgpu renderer and triangle shader.
    `cxx/NativeTerminalMacOS.mm` borrows the Lynx IOSurface and imports it using
    the renderer's own MTLDevice; wait for GPU completion before swapping buffers.
  - `src/atlas.rs`: Alacritty shelf atlas port; staging-buffer rows must be aligned
    to 256 bytes. Clearing the atlas invalidates glyph handles via generation.
    `src/atlas_demo.rs` / `src/atlas.wgsl` exercise uploads and instanced sampling
    with real crossfont glyphs. `src/font.rs` caches by font/character/size, uses
    Menlo regular/bold with CoreText fallback, and invalidates on backing-scale
    changes. Mask pages are R8Unorm; color pages are premultiplied RGBA8Unorm.
    Keep crossfont platform defaults; custom grayscale AA is deferred.
  - `src/tests/`: External unit-test modules for counter, atlas and fonts;
    attached as child modules so private implementation stays private.
  - `cxx/`: All C++ / Objective-C++ components and the single CMake target.
  - `build.mjs`: napi-rs CLI build entry; `index.cjs` and `lynx.lib.json` support AutoLink.
  - Register additional elements with unique module/tag names via `LYNX_REGISTER_ELEMENT`;
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
  - Use `className` for styling.
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
    <view className="container">
      <text className="title">Count: {count}</text>
      <view className="button" bindtap={handleTap}>
        <text className="button-text">Increment</text>
      </view>
    </view>
  );
}
```

## Local Type Definitions

Inspect local types for exact API surfaces:
- `node_modules/@lynx-js/lynxtron/apis/lynxtron.d.ts`
