// Copyright 2026 The Lynxtron Authors. All rights reserved.
// Licensed under the Apache License Version 2.0 that can be found in the
// LICENSE file in the root directory of this source tree.

/**
 * PC Preload Script
 * Exported content will be automatically mapped to NativeModules.nodejs
 */

import { contextBridge } from '@lynx-js/lynxtron/context-bridge';
import nativeBinding from '@catus/native/lynxtron';
import { listShells } from './shells';
import type { WorkspaceSettings, WorkspaceEnvironment } from '../../shared/workspaces';
import type { TabKind } from '../../shared/tabs';
import { resolveLaunch } from '../../shared/workspaces';
import { resolveTmuxLaunch } from '../../shared/launch';
import { createWorkspaceHost } from './workspaceConfig';
import { TextEncoder, TextDecoder } from 'node:util';
const workspaces = createWorkspaceHost();
contextBridge.exposeInLynxBTS({
  createTextEncoder: () => new TextEncoder(),
  createTextDecoder: (label?: string, options?: ConstructorParameters<typeof TextDecoder>[1]) =>
    new TextDecoder(label, options),
  listShells,
  loadWorkspaces: workspaces.loadWorkspaces,
  saveWorkspaces: workspaces.saveWorkspaces,
  createTerminalSession: (
    id: number,
    profile?: WorkspaceSettings,
    environment?: WorkspaceEnvironment,
    kind: TabKind = 'shell',
  ) =>
    nativeBinding.createTerminalSession(
      id,
      process.env.CATUS_E2E_PTY
        ? {
            workspaceId: profile?.id,
            program: process.env.CATUS_E2E_NODE ?? process.execPath,
            args: [process.env.CATUS_E2E_PTY],
          }
        : profile && environment
          ? (() => {
              if (kind === 'tmux') {
                return {
                  workspaceId: profile.id,
                  ...resolveTmuxLaunch(profile, environment, id, process.env.CATUS_E2E_TMUX_SOCKET),
                };
              }
              const launch = resolveLaunch(profile, environment);
              return {
                workspaceId: profile.id,
                program: launch.command,
                args: [...launch.args],
                cwd: launch.cwd,
              };
            })()
          : undefined,
    ),
  dispatchAnimationFrame: () => nativeBinding.dispatchAnimationFrame(),
  closeTerminalSession: (id: number) => nativeBinding.closeTerminalSession(id),
  detachTerminalSession: (id: number) => nativeBinding.detachTerminalSession(id),
  getTmuxSessionInfo: (id: number) => nativeBinding.getTmuxSessionInfo(id) ?? undefined,
  selectTmuxWindow: (id: number, windowId: string) => {
    nativeBinding.selectTmuxWindow(id, windowId);
  },
  createTmuxWindow: (id: number) => {
    nativeBinding.createTmuxWindow(id);
  },
  closeTmuxWindow: (id: number, windowId: string) => {
    nativeBinding.closeTmuxWindow(id, windowId);
  },
  ...(process.env.CATUS_E2E_PTY || process.env.CATUS_E2E_TMUX_SOCKET
    ? { getTerminalSessionInfo: (id: number) => nativeBinding.getTerminalSessionInfo(id) }
    : {}),
  echo: (message: string) => {
    return `Echo from PC Service Thread: ${message}`;
  },
});

console.log('[PC Preload] Node.js capabilities exported');
