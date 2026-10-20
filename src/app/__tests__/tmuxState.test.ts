import { afterEach, beforeEach, expect, rstest, test } from '@rstest/core';
import * as AtomRegistry from 'effect/reactivity/AtomRegistry';
import defaults from '../../../tests/fixtures/workspaces.json';
import { parseWorkspaceConfig } from '../../shared/workspaces';
import { sessionAtom, tabAtom, workspaceAtom } from '../state/session';
import { terminalHostAtom } from '../state/terminalSessions';
import type { TerminalHost } from '../state/terminalSessions';
import { tmuxActionsAtom, tmuxSessionAtom, tmuxSyncAtom } from '../state/tmux';
import type { TmuxSessionInfo } from '../../shared/tmux';

const profile = parseWorkspaceConfig(defaults).workspaces[0]!;
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

function workspace(tabIds: readonly number[], activeTabId: number | undefined) {
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
    workspaceIds: ['w'],
    activeWorkspaceId: 'w',
    nextTab: 8,
  });
  registry.set(workspaceAtom('w'), workspace([7], 7));
  registry.set(tabAtom(7), {
    id: 7,
    workspaceId: 'w',
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

  registry.set(workspaceAtom('w'), workspace([], undefined));
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
