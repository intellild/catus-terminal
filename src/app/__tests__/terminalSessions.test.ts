import { afterEach, beforeEach, expect, rstest, test } from '@rstest/core';
import * as AtomRegistry from 'effect/reactivity/AtomRegistry';
import defaults from '../../../config/workspaces.json';
import { parseWorkspaceConfig } from '../../shared/workspaces';
import {
  applyConfig,
  closeTab,
  newTab,
  selectWorkspace,
  sessionAtom,
  sessionViewAtom,
} from '../state/session';
import { terminalHostAtom } from '../state/terminalSessions';

const payload = {
  config: parseWorkspaceConfig(defaults),
  path: '/tmp/catus/workspaces.json',
  environment: { shell: '/bin/zsh', home: '/Users/test' },
};
let registry: AtomRegistry.AtomRegistry;
let live: Set<number>;
let host: {
  createTerminalSession: ReturnType<typeof rstest.fn<(id: number) => void>>;
  closeTerminalSession: ReturnType<typeof rstest.fn<(id: number) => void>>;
};
beforeEach(() => {
  registry = AtomRegistry.make();
  live = new Set();
  host = {
    createTerminalSession: rstest.fn((id: number) => {
      if (live.has(id)) throw new Error(`Duplicate ID: ${id}`);
      live.add(id);
    }),
    closeTerminalSession: rstest.fn((id: number) => {
      expect(live.delete(id)).toBe(true);
    }),
  };
  registry.set(terminalHostAtom, host);
});
afterEach(() => registry.dispose());

function start() {
  registry.update(sessionAtom, (state) => applyConfig(state, payload));
}

test('atom writes allocate and release sessions without React or UI subscriptions', () => {
  start();
  registry.update(sessionAtom, (state) => newTab(state));
  registry.update(sessionAtom, (state) => selectWorkspace(state, 'node'));
  expect([...live]).toEqual([1, 2, 3]);
  expect(host.createTerminalSession.mock.calls).toEqual([[1], [2], [3]]);
  // A background tab can close without rendering any terminal view.
  registry.update(sessionAtom, (state) => closeTab(state, 2));
  expect([...live]).toEqual([1, 3]);
  expect(registry.get(sessionAtom).tabs.map((tab) => tab.id)).toEqual([1, 3]);
  expect(host.closeTerminalSession.mock.calls).toEqual([[2]]);
  registry.update(sessionAtom, (state) => closeTab(state, 2));
  expect(host.closeTerminalSession).toHaveBeenCalledOnce();
  registry.update(sessionAtom, (state) => newTab(state));
  expect([...live]).toEqual([1, 3, 4]);
  const release = registry.mount(sessionViewAtom);
  release();
  expect([...live]).toEqual([1, 3, 4]);
  expect(host.createTerminalSession).toHaveBeenCalledTimes(4);
});

test('removing a workspace closes only its sessions; registry disposal closes the remainder', () => {
  start();
  registry.update(sessionAtom, (state) => selectWorkspace(state, 'node'));
  registry.update(sessionAtom, (state) => newTab(state));
  registry.update(sessionAtom, (state) =>
    applyConfig(state, {
      ...payload,
      config: {
        version: 1,
        workspaces: payload.config.workspaces.filter((item) => item.id !== 'node'),
      },
    }),
  );
  expect([...live]).toEqual([1]);
  expect(host.closeTerminalSession.mock.calls).toEqual([[2], [3]]);
  registry.dispose();
  expect([...live]).toEqual([]);
  expect(host.closeTerminalSession.mock.calls).toEqual([[2], [3], [1]]);
});

test('creation errors stay in atom state, never bind a missing ID, and are not closed as live sessions', () => {
  host.createTerminalSession.mockImplementationOnce(() => {
    throw new Error('PTY failed');
  });
  start();
  expect(registry.get(sessionViewAtom).terminalId).toBe(0);
  expect(registry.get(sessionViewAtom).terminalError).toContain('PTY failed');
  registry.update(sessionAtom, (state) => selectWorkspace(state, 'shell'));
  expect(host.createTerminalSession).toHaveBeenCalledOnce();
  registry.update(sessionAtom, (state) => closeTab(state, 1));
  expect(host.closeTerminalSession).not.toHaveBeenCalled();
  expect(registry.get(sessionAtom).terminalErrors).toEqual({});
  registry.update(sessionAtom, (state) => newTab(state));
  expect(registry.get(sessionViewAtom).terminalId).toBe(2);
  expect(registry.get(sessionViewAtom).terminalError).toBe('');
});
