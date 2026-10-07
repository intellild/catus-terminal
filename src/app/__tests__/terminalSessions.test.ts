import { afterEach, beforeEach, expect, rstest, test } from '@rstest/core';
import * as AtomRegistry from 'effect/reactivity/AtomRegistry';
import defaults from '../../../tests/fixtures/workspaces.json';
import { parseWorkspaceConfig } from '../../shared/workspaces';
import {
  applyConfig,
  closeTab,
  newTab,
  selectWorkspace,
  allTabsAtom,
  terminalErrorsAtom,
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

// Simulate UI observing the empty state before configuration loads.
function start() {
  registry.get(allTabsAtom);
  applyConfig(registry, payload);
}

test('atom writes allocate and release sessions without React or UI subscriptions', () => {
  start();
  newTab(registry);
  selectWorkspace(registry, 'local');
  expect([...live]).toEqual([1, 2, 3]);
  expect(host.createTerminalSession.mock.calls.map(([id]) => [id])).toEqual([[1], [2], [3]]);
  // A background tab can close without rendering any terminal view.
  closeTab(registry, 2);
  expect([...live]).toEqual([1, 3]);
  expect(registry.get(allTabsAtom).map((tab) => tab.id)).toEqual([1, 3]);
  expect(host.closeTerminalSession.mock.calls).toEqual([[2]]);
  closeTab(registry, 2);
  expect(host.closeTerminalSession).toHaveBeenCalledOnce();
  newTab(registry);
  expect([...live]).toEqual([1, 3, 4]);
  const release = registry.mount(sessionViewAtom);
  release();
  expect([...live]).toEqual([1, 3, 4]);
  expect(host.createTerminalSession).toHaveBeenCalledTimes(4);
});

test('removing a workspace closes only its sessions; registry disposal closes the remainder', () => {
  start();
  selectWorkspace(registry, 'local');
  newTab(registry);
  applyConfig(registry, {
    ...payload,
    config: {
      version: 1,
      workspaces: payload.config.workspaces.filter((item) => item.id !== 'local'),
    },
  });
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
  selectWorkspace(registry, 'shell');
  expect(host.createTerminalSession).toHaveBeenCalledOnce();
  closeTab(registry, 1);
  expect(host.closeTerminalSession).not.toHaveBeenCalled();
  expect(registry.get(terminalErrorsAtom)).toEqual({});
  newTab(registry);
  expect(registry.get(sessionViewAtom).terminalId).toBe(2);
  expect(registry.get(sessionViewAtom).terminalError).toBe('');
});

test('SFTP tabs have no PTY; closing during connection still releases the late connection', async () => {
  const close = rstest.fn(async () => {});
  let finish!: (fs: import('../../shared/sftp').RemoteFs) => void;
  const pending = new Promise<import('../../shared/sftp').RemoteFs>((resolve) => {
    finish = resolve;
  });
  const connectSftp = rstest.fn(() => pending);
  registry.set(terminalHostAtom, { ...host, connectSftp });
  const profile = { ...payload.config.workspaces[0]!, type: 'ssh' as const, host: 'example' };
  applyConfig(registry, { ...payload, config: { version: 1, workspaces: [profile] } });
  newTab(registry, profile.id, 'sftp');
  await Promise.resolve();
  expect(host.createTerminalSession).toHaveBeenCalledOnce();
  expect(connectSftp).toHaveBeenCalledWith({ destination: 'example' });
  expect(registry.get(sessionViewAtom).terminalId).toBe(0);
  closeTab(registry, 2);
  finish({ close, readdir: rstest.fn(), stat: rstest.fn(), realpath: rstest.fn() });
  await rstest.waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(host.closeTerminalSession).not.toHaveBeenCalled();
  expect([...live]).toEqual([1]);
});
