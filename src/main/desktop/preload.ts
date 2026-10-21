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
import { killTmuxSession, listTmuxSessions } from './tmux';
import type { HostProfile, HostEnvironment } from '../../shared/hosts';
import type { TabKind } from '../../shared/tabs';
import { resolveLaunch } from '../../shared/hosts';
import { resolveTmuxLaunch } from '../../shared/launch';
import { createHostService } from './host-config';
import { TextEncoder, TextDecoder } from 'node:util';
const hosts = createHostService();
contextBridge.exposeInLynxBTS({
  createTextEncoder: () => new TextEncoder(),
  createTextDecoder: (label?: string, options?: ConstructorParameters<typeof TextDecoder>[1]) =>
    new TextDecoder(label, options),
  listShells,
  listTmuxSessions,
  killTmuxSession,
  loadHosts: hosts.loadHosts,
  saveHosts: hosts.saveHosts,
  createTerminalSession: (
    id: number,
    profile?: HostProfile,
    environment?: HostEnvironment,
    kind: TabKind = 'shell',
    tmuxSession?: string,
  ) =>
    nativeBinding.createTerminalSession(
      id,
      process.env.CATUS_E2E_PTY
        ? {
            hostId: profile?.id,
            program: process.env.CATUS_E2E_NODE ?? process.execPath,
            args: [process.env.CATUS_E2E_PTY],
          }
        : profile && environment
          ? (() => {
              if (kind === 'tmux') {
                return {
                  hostId: profile.id,
                  ...resolveTmuxLaunch(
                    profile,
                    environment,
                    id,
                    process.env.CATUS_E2E_TMUX_SOCKET,
                    tmuxSession,
                  ),
                };
              }
              const launch = resolveLaunch(profile, environment);
              return {
                hostId: profile.id,
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
