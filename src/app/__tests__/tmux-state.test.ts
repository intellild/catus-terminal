import { afterEach, beforeEach, expect, rstest, test } from '@rstest/core';
import * as AtomRegistry from 'effect/reactivity/AtomRegistry';
import defaults from '../../../tests/fixtures/hosts.json';
import { parseHostsConfig } from '../../shared/hosts';
import { sessionAtom, tabAtom, hostAtom } from '../state/session';
import { terminalHostAtom } from '../state/terminal-sessions';
import type { TerminalHost } from '../state/terminal-sessions';
import {
  tmuxActionsAtom,
  tmuxSessionAtom,
  tmuxSessionsSyncAtom,
  tmuxSessionsViewAtom,
  tmuxSyncAtom,
} from '../state/tmux';
import { closeTmuxSessionAtom, tmuxSessionsAtom } from '../state/tmux-sessions';
import { sessionActionsAtom } from '../state/session-actions';
import { hostServiceAtom } from '../state/host-service';
import type { TmuxSessionInfo } from '../../shared/tmux';

const profile = parseHostsConfig(defaults).hosts[0]!;
const first: TmuxSessionInfo = {
  activeWindowId: '@1',
  windows: [
    { id: '@1', index: 0, name: 'shell', active: true },
    { id: '@2', index: 1, name: 'logs', active: false },
  ],
};
const second: TmuxSessionInfo = {
  activeWindowId: '@2',
  windows: [{ id: '@2', index: 1, name: 'logs', active: true }],
};

let registry: AtomRegistry.AtomRegistry;
let getTmuxSessionInfo: ReturnType<typeof rstest.fn>;
let selectTmuxWindow: ReturnType<typeof rstest.fn>;
let createTmuxWindow: ReturnType<typeof rstest.fn>;
let closeTmuxWindow: ReturnType<typeof rstest.fn>;

function host(tabIds: readonly number[], activeTabId: number | undefined) {
  return { profile, tabIds, activeTabId };
}

beforeEach(() => {
  registry = AtomRegistry.make();
  getTmuxSessionInfo = rstest.fn(() => first);
  selectTmuxWindow = rstest.fn();
  createTmuxWindow = rstest.fn();
  closeTmuxWindow = rstest.fn();
  registry.set(terminalHostAtom, {
    createTerminalSession: rstest.fn(),
    closeTerminalSession: rstest.fn(),
    getTmuxSessionInfo,
    selectTmuxWindow,
    createTmuxWindow,
    closeTmuxWindow,
  } satisfies TerminalHost);
  registry.set(sessionAtom, {
    payload: null,
    hostIds: ['w'],
    activeHostId: 'w',
    nextTab: 8,
  });
  registry.set(hostAtom('w'), host([7], 7));
  registry.set(tabAtom(7), {
    id: 7,
    hostId: 'w',
    kind: 'tmux',
    number: 7,
    profile,
  });
});

afterEach(() => registry.dispose());

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

test('tmux snapshots are global, polled by session ID and cleared on tab release', async () => {
  registry.set(tmuxSyncAtom, undefined);
  await rstest.waitFor(() => expect(registry.get(tmuxSessionAtom(7))).toEqual(first));
  expect(getTmuxSessionInfo).toHaveBeenCalledWith(7);

  getTmuxSessionInfo.mockReturnValue(second);
  await wait(450);
  expect(registry.get(tmuxSessionAtom(7))).toEqual(second);

  registry.set(tmuxActionsAtom, { type: 'selectWindow', sessionId: 7, windowId: '@2' });
  expect(selectTmuxWindow).toHaveBeenCalledWith(7, '@2');
  // Commands refresh the registry snapshot immediately.
  expect(registry.get(tmuxSessionAtom(7))).toEqual(second);

  registry.set(tmuxActionsAtom, { type: 'createWindow', sessionId: 7 });
  registry.set(tmuxActionsAtom, { type: 'closeWindow', sessionId: 7, windowId: '@2' });
  expect(createTmuxWindow).toHaveBeenCalledWith(7);
  expect(closeTmuxWindow).toHaveBeenCalledWith(7, '@2');

  registry.set(hostAtom('w'), host([], undefined));
  await wait(450);
  expect(registry.get(tmuxSessionAtom(7))).toBeUndefined();
});

test('resetting the registry cancels tmux polling', async () => {
  registry.set(tmuxSyncAtom, undefined);
  await rstest.waitFor(() => expect(registry.get(tmuxSessionAtom(7))).toEqual(first));
  const calls = getTmuxSessionInfo.mock.calls.length;
  registry.reset();
  await wait(450);
  expect(getTmuxSessionInfo).toHaveBeenCalledTimes(calls);
});

test('session lists drive the badge, attach targets and explicit session close', async () => {
  const sessions = [
    { name: 'work', windows: 2, attached: 1, activity: 30 },
    { name: 'catus-0', windows: 1, attached: 0, activity: 10 },
  ];
  const listTmuxSessions = rstest.fn(async () => sessions);
  const killTmuxSession = rstest.fn(async () => {});
  registry.set(hostServiceAtom, {
    loadHosts: rstest.fn(),
    saveHosts: rstest.fn(),
    listTmuxSessions,
    killTmuxSession,
  });
  registry.set(tmuxSessionsSyncAtom, undefined);
  await rstest.waitFor(() => expect(registry.get(tmuxSessionsAtom('')).sessions).toHaveLength(2));
  expect(registry.get(tmuxSessionsViewAtom).sessions[0]!.name).toBe('work');

  registry.set(sessionActionsAtom, { type: 'attachTmux', session: 'work' });
  expect(registry.get(tabAtom(8))).toMatchObject({ kind: 'tmux', tmuxSession: 'work' });
  const terminal = registry.get(terminalHostAtom)!;
  expect(terminal.createTerminalSession).toHaveBeenCalledWith(
    8,
    profile,
    undefined,
    'tmux',
    'work',
  );

  // New sessions use the next free prefix index instead of reattaching.
  registry.set(sessionActionsAtom, { type: 'newTmuxSession' });
  expect(registry.get(tabAtom(9))).toMatchObject({ kind: 'tmux', tmuxSession: 'catus-1' });

  // A plain tmux tab reuses the most recently active session from the registry.
  registry.set(sessionActionsAtom, { type: 'addTab', kind: 'tmux' });
  expect(registry.get(tabAtom(10))).toMatchObject({ kind: 'tmux', tmuxSession: 'work' });
  // Without a cached list the launcher keeps tmux's own default target.
  registry.set(tmuxSessionsAtom(''), { sessions: [], loaded: true, pending: false, error: '' });
  registry.set(sessionActionsAtom, { type: 'addTab', kind: 'tmux' });
  expect(registry.get(tabAtom(11))?.tmuxSession).toBeUndefined();

  registry.set(closeTmuxSessionAtom, { destination: '', session: 'work' });
  await rstest.waitFor(() => expect(killTmuxSession).toHaveBeenCalledWith(undefined, 'work'));
  registry.reset();
});
