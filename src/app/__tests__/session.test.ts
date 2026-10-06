import { expect, test, rstest } from '@rstest/core';
import * as AtomRegistry from 'effect/reactivity/AtomRegistry';
import { terminalHostAtom } from '../state/terminalSessions';
import defaults from '../../../config/workspaces.json';
import { parseWorkspaceConfig, resolveLaunch } from '../../shared/workspaces';
import {
  applyConfig,
  closeTab,
  emptySession,
  newTab,
  selectTab,
  selectWorkspace,
  sessionAtom,
  sessionViewAtom,
} from '../state/session';

const payload = {
  config: parseWorkspaceConfig(defaults),
  path: '/tmp/workspaces.json',
  environment: { shell: '/bin/zsh', home: '/Users/test' },
};

test('startup opens only the first workspace and repeated activation preserves its tabs', () => {
  let state = applyConfig(emptySession, payload);
  expect(state.tabs).toHaveLength(1);
  expect(state.tabs[0]!.workspaceId).toBe('shell');
  state = selectWorkspace(state, 'node');
  state = newTab(state);
  const activeNode = state.activeTabs.node;
  expect(state.tabs).toHaveLength(3);
  state = selectWorkspace(state, 'shell');
  expect(state.activeTabs.shell).toBe(1);
  state = selectWorkspace(state, 'node');
  expect(state.activeTabs.node).toBe(activeNode);
  expect(selectWorkspace(state, 'node').tabs).toHaveLength(3);
});

test('closing tabs selects a neighbor; closing the last tab stops the workspace until restarted', () => {
  let state = newTab(applyConfig(emptySession, payload));
  state = newTab(state);
  state = selectTab(state, 2);
  state = closeTab(state, 2);
  expect(state.activeTabs.shell).toBe(3);
  state = closeTab(state, 3);
  expect(state.activeTabs.shell).toBe(1);
  state = closeTab(state, 1);
  expect(state.tabs).toHaveLength(0);
  expect(state.activeTabs.shell).toBeUndefined();
  expect(state.activeWorkspaceId).toBe('shell');
  state = selectWorkspace(state, 'shell');
  expect(state.tabs).toHaveLength(1);
  expect(state.activeTabs.shell).toBe(4);
});

test('profile edits apply to new tabs, while deleting a workspace removes only its sessions', () => {
  let state = selectWorkspace(applyConfig(emptySession, payload), 'node');
  const updated = {
    ...payload,
    config: {
      version: 1 as const,
      workspaces: payload.config.workspaces.map((workspace) =>
        workspace.id === 'node' ? { ...workspace, command: 'node-custom' } : workspace,
      ),
    },
  };
  state = newTab(applyConfig(state, updated));
  expect(state.tabs[1]!.profile.command).toBe('node');
  expect(state.tabs[2]!.profile.command).toBe('node-custom');
  state = applyConfig(state, {
    ...updated,
    config: {
      version: 1,
      workspaces: updated.config.workspaces.filter((workspace) => workspace.id !== 'node'),
    },
  });
  expect(state.tabs).toHaveLength(1);
  expect(state.activeWorkspaceId).toBe('shell');
});

test('Effect Atom derived view reflects active tabs and dock indicators', () => {
  const registry = AtomRegistry.make();
  registry.set(terminalHostAtom, {
    createTerminalSession: rstest.fn(),
    closeTerminalSession: rstest.fn(),
  });
  const release = registry.mount(sessionViewAtom);
  registry.set(sessionAtom, applyConfig(emptySession, payload));
  expect(registry.get(sessionViewAtom).runningIds.has('shell')).toBe(true);
  registry.update(sessionAtom, (state) => selectWorkspace(state, 'python'));
  expect(registry.get(sessionViewAtom).activeTab?.workspaceId).toBe('python');
  expect(registry.get(sessionViewAtom).runningIds.size).toBe(2);
  registry.update(sessionAtom, (state) => closeTab(state, state.activeTabs.python!));
  expect(registry.get(sessionViewAtom).runningIds.has('python')).toBe(false);
  release();
  registry.dispose();
});

test('configuration validates IDs and commands and resolves the account shell and home', () => {
  expect(resolveLaunch(payload.config.workspaces[0]!, payload.environment)).toEqual({
    command: '/bin/zsh',
    args: ['-l'],
    cwd: '/Users/test',
  });
  expect(() => parseWorkspaceConfig({ version: 1, workspaces: [] })).toThrow();
  expect(() =>
    parseWorkspaceConfig({
      version: 1,
      workspaces: [defaults.workspaces[0], defaults.workspaces[0]],
    }),
  ).toThrow('Duplicate');
  expect(() =>
    parseWorkspaceConfig({ version: 1, workspaces: [{ ...defaults.workspaces[0], command: ' ' }] }),
  ).toThrow('blank');
});

test('SSH launch uses argv and quotes preview without interpolating a host into a shell', async () => {
  const { launchPreview } = await import('../../shared/launch');
  const profile = {
    ...payload.config.workspaces[0]!,
    type: 'ssh' as const,
    host: 'user@server',
    remoteCommand: "printf 'hello world'",
  };
  expect(resolveLaunch(profile, payload.environment)).toEqual({
    command: 'ssh',
    args: ['-t', '--', 'user@server', "printf 'hello world'"],
    cwd: '/Users/test',
  });
  expect(launchPreview(profile, payload.environment)).toBe(
    "'ssh' '-t' '--' 'user@server' 'printf '\\''hello world'\\''' ".trim(),
  );
  expect(() =>
    parseWorkspaceConfig({
      ...payload.config,
      workspaces: [{ ...profile, host: '-oProxyCommand=bad' }],
    }),
  ).toThrow();
  const state = applyConfig(emptySession, {
    ...payload,
    config: { version: 1, workspaces: [profile] },
  });
  expect(newTab(state, profile.id, 'sftp').tabs[1]?.kind).toBe('sftp');
  expect(newTab(applyConfig(emptySession, payload), 'shell', 'sftp').tabs).toHaveLength(1);
  expect(
    resolveLaunch(
      { ...profile, type: 'local', command: 'printf hello', args: [] },
      payload.environment,
    ),
  ).toEqual({ command: '/bin/zsh', args: ['-lc', 'printf hello'], cwd: '/Users/test' });
});
