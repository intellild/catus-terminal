import { afterEach, beforeEach, expect, test, rstest } from '@rstest/core';
import * as AtomRegistry from 'effect/reactivity/AtomRegistry';
import { terminalHostAtom } from '../state/terminalSessions';
import defaults from '../../../tests/fixtures/workspaces.json';
import { parseWorkspaceConfig, resolveLaunch } from '../../shared/workspaces';
import {
  applyConfig,
  closeTab,
  allTabsAtom,
  workspaceAtom,
  workspaceIdsAtom,
  workspaceProfilesAtom,
  tabAtom,
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

let registry: AtomRegistry.AtomRegistry;
beforeEach(() => {
  registry = AtomRegistry.make();
  registry.set(terminalHostAtom, {
    createTerminalSession: rstest.fn(),
    closeTerminalSession: rstest.fn(),
  });
});
afterEach(() => registry.dispose());

test('startup opens only the first workspace and repeated activation preserves its tabs', () => {
  applyConfig(registry, payload);
  expect(registry.get(sessionAtom).workspaceIds).toEqual(['shell', 'local']);
  expect(registry.get(workspaceAtom('shell'))?.tabIds).toEqual([1]);
  expect(registry.get(workspaceAtom('local'))?.tabIds).toEqual([]);
  selectWorkspace(registry, 'local');
  newTab(registry);
  const local = registry.get(workspaceAtom('local'));
  expect(local?.tabIds).toEqual([2, 3]);
  expect(local?.activeTabId).toBe(3);
  selectWorkspace(registry, 'shell');
  expect(registry.get(workspaceAtom('shell'))?.activeTabId).toBe(1);
  selectWorkspace(registry, 'local');
  expect(registry.get(workspaceAtom('local'))).toBe(local);
  selectWorkspace(registry, 'local');
  expect(registry.get(allTabsAtom)).toHaveLength(3);
});

test('closing tabs selects a neighbor; closing the last tab stops the workspace until restarted', () => {
  applyConfig(registry, payload);
  newTab(registry);
  newTab(registry);
  selectTab(registry, 2);
  closeTab(registry, 2);
  expect(registry.get(workspaceAtom('shell'))?.activeTabId).toBe(3);
  expect(registry.get(tabAtom(2))).toBeUndefined();
  closeTab(registry, 3);
  expect(registry.get(workspaceAtom('shell'))?.activeTabId).toBe(1);
  closeTab(registry, 1);
  expect(registry.get(workspaceAtom('shell'))?.tabIds).toEqual([]);
  expect(registry.get(workspaceAtom('shell'))?.activeTabId).toBeUndefined();
  expect(registry.get(sessionAtom).activeWorkspaceId).toBe('shell');
  selectWorkspace(registry, 'shell');
  expect(registry.get(workspaceAtom('shell'))?.tabIds).toEqual([4]);
  expect(registry.get(workspaceAtom('shell'))?.activeTabId).toBe(4);
});

test('profile edits apply to new tabs, while deleting a workspace removes only its sessions', () => {
  applyConfig(registry, payload);
  selectWorkspace(registry, 'local');
  const updated = {
    ...payload,
    config: {
      version: 1 as const,
      workspaces: payload.config.workspaces.map((workspace) =>
        workspace.id === 'local' ? { ...workspace, command: '/bin/bash' } : workspace,
      ),
    },
  };
  applyConfig(registry, updated);
  newTab(registry);
  expect(registry.get(tabAtom(2))!.profile.command).toBe('/bin/sh');
  expect(registry.get(tabAtom(3))!.profile.command).toBe('/bin/bash');
  applyConfig(registry, {
    ...updated,
    config: {
      version: 1,
      workspaces: updated.config.workspaces.filter((workspace) => workspace.id !== 'local'),
    },
  });
  expect(registry.get(allTabsAtom)).toHaveLength(1);
  expect(registry.get(workspaceAtom('local'))).toBeUndefined();
  expect(registry.get(tabAtom(2))).toBeUndefined();
  expect(registry.get(tabAtom(3))).toBeUndefined();
  expect(registry.get(sessionAtom).activeWorkspaceId).toBe('shell');
});

test('Effect Atom derived view reflects active tabs and dock indicators', () => {
  const release = registry.mount(sessionViewAtom);
  applyConfig(registry, payload);
  expect(registry.get(sessionViewAtom).runningIds.has('shell')).toBe(true);
  selectWorkspace(registry, 'local');
  expect(registry.get(sessionViewAtom).activeTab?.workspaceId).toBe('local');
  expect(registry.get(sessionViewAtom).runningIds.size).toBe(2);
  closeTab(registry, registry.get(workspaceAtom('local'))!.activeTabId!);
  expect(registry.get(sessionViewAtom).runningIds.has('local')).toBe(false);
  release();
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
  ).toThrow('validation.required');
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
  applyConfig(registry, {
    ...payload,
    config: { version: 1, workspaces: [profile] },
  });
  newTab(registry, profile.id, 'sftp');
  expect(registry.get(tabAtom(2))?.kind).toBe('sftp');
  applyConfig(registry, payload);
  const count = registry.get(allTabsAtom).length;
  newTab(registry, 'shell', 'sftp');
  expect(registry.get(allTabsAtom)).toHaveLength(count);
  expect(
    resolveLaunch(
      { ...profile, type: 'local', command: 'printf hello', args: [] },
      payload.environment,
    ),
  ).toEqual({ command: '/bin/zsh', args: ['-lc', 'printf hello'], cwd: '/Users/test' });
});

test('selected shells launch directly locally and become a quoted SSH command remotely', () => {
  const profile = { ...payload.config.workspaces[0]!, shell: '/bin/zsh', args: [] };
  expect(resolveLaunch(profile, payload.environment)).toEqual({
    command: '/bin/zsh',
    args: ['-l'],
    cwd: '/Users/test',
  });
  expect(
    resolveLaunch(
      { ...profile, type: 'ssh', host: 'alias', remoteCommand: 'cd /srv' },
      payload.environment,
    ),
  ).toEqual({
    command: 'ssh',
    args: ['-t', '--', 'alias', "cd /srv; exec '/bin/zsh' -l"],
    cwd: '/Users/test',
  });
  expect(
    resolveLaunch(
      { ...profile, type: 'ssh', host: 'alias', shell: 'custom', command: 'exec fish' },
      payload.environment,
    ).args,
  ).toEqual(['-t', '--', 'alias', 'exec fish']);
});

test('workspace families keep their own membership and updates do not notify other workspaces', () => {
  applyConfig(registry, payload);
  selectWorkspace(registry, 'local');
  const shell = registry.get(workspaceAtom('shell'));
  const ids = registry.get(workspaceIdsAtom);
  registry.get(workspaceProfilesAtom);
  const shellChanged = rstest.fn();
  const idsChanged = rstest.fn();
  const profilesChanged = rstest.fn();
  const stops = [
    registry.subscribe(workspaceAtom('shell'), shellChanged),
    registry.subscribe(workspaceIdsAtom, idsChanged),
    registry.subscribe(workspaceProfilesAtom, profilesChanged),
  ];
  newTab(registry);
  selectTab(registry, 2);
  closeTab(registry, 3);
  expect(registry.get(workspaceAtom('local'))?.tabIds).toEqual([2]);
  expect(registry.get(workspaceAtom('local'))?.activeTabId).toBe(2);
  expect(registry.get(workspaceAtom('shell'))).toBe(shell);
  expect(registry.get(workspaceIdsAtom)).toBe(ids);
  registry.get(workspaceProfilesAtom);
  expect(shellChanged).not.toHaveBeenCalled();
  expect(idsChanged).not.toHaveBeenCalled();
  expect(profilesChanged).not.toHaveBeenCalled();
  expect(registry.get(sessionAtom).payload).not.toHaveProperty('config');
  expect(registry.get(sessionAtom)).not.toHaveProperty('tabs');
  expect(registry.get(sessionAtom)).not.toHaveProperty('activeTabs');
  stops.forEach((stop) => stop());
  registry.reset();
  expect(registry.get(workspaceIdsAtom)).toEqual([]);
  expect(registry.get(workspaceAtom('shell'))).toBeUndefined();
  expect(registry.get(tabAtom(2))).toBeUndefined();
});
