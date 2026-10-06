// Copyright 2026 The Lynxtron Authors. All rights reserved.
// Licensed under the Apache License Version 2.0 that can be found in the
// LICENSE file in the root directory of this source tree.

/**
 * PC Preload Script
 * Exported content will be automatically mapped to NativeModules.nodejs
 */

import { contextBridge } from '@lynx-js/lynxtron/context-bridge';
import nativeBinding from '@catus/native/lynxtron';
import { createWorkspaceHost } from './workspaceConfig';
import { TextEncoder, TextDecoder } from 'node:util';
const workspaces = createWorkspaceHost();
contextBridge.exposeInLynxBTS({
  createTextEncoder: () => new TextEncoder(),
  createTextDecoder: (label?: string, options?: ConstructorParameters<typeof TextDecoder>[1]) =>
    new TextDecoder(label, options),
  loadWorkspaces: workspaces.loadWorkspaces,
  saveWorkspaces: workspaces.saveWorkspaces,
  createTerminalSession: (id: number) =>
    nativeBinding.createTerminalSession(
      id,
      process.env.CATUS_E2E_PTY
        ? {
            program: process.env.CATUS_E2E_NODE ?? process.execPath,
            args: [process.env.CATUS_E2E_PTY],
          }
        : undefined,
    ),
  dispatchAnimationFrame: () => nativeBinding.dispatchAnimationFrame(),
  closeTerminalSession: (id: number) => nativeBinding.closeTerminalSession(id),
  ...(process.env.CATUS_E2E_PTY
    ? { getTerminalSessionInfo: (id: number) => nativeBinding.getTerminalSessionInfo(id) }
    : {}),
  echo: (message: string) => {
    return `Echo from PC Service Thread: ${message}`;
  },
});

console.log('[PC Preload] Node.js capabilities exported');
