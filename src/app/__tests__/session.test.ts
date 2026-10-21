import { afterEach, beforeEach, expect, test, rstest } from '@rstest/core';
import * as AtomRegistry from 'effect/reactivity/AtomRegistry';
import { terminalHostAtom } from '../state/terminal-sessions';
import defaults from '../../../tests/fixtures/config.json';
import { parseConfig } from '../../shared/config';
import { resolveLaunch } from '../../shared/launch';
import {
  applyConfig,
  closeTab,
  allTabsAtom,
  hostAtom,
  hostIdsAtom,
  hostProfilesAtom,
  tabAtom,
  newTab,
  selectTab,
  selectHost,
  sessionAtom,
  sessionViewAtom,
} from '../state/session';

const payload = {
  config: parseConfig(defaults),
  path: '/tmp/config.json',
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

test('startup opens only the first host and repeated activation preserves its tabs', () => {
  applyConfig(registry, payload);
  expect(registry.get(sessionAtom).hostIds).toEqual(['shell', 'local']);
  expect(registry.get(hostAtom('shell'))?.tabIds).toEqual([1]);
  expect(registry.get(hostAtom('local'))?.tabIds).toEqual([]);
  selectHost(registry, 'local');
  newTab(registry);
  const local = registry.get(hostAtom('local'));
  expect(local?.tabIds).toEqual([2, 3]);
  expect(local?.activeTabId).toBe(3);
  selectHost(registry, 'shell');
  expect(registry.get(hostAtom('shell'))?.activeTabId).toBe(1);
  selectHost(registry, 'local');
  expect(registry.get(hostAtom('local'))).toBe(local);
  selectHost(registry, 'local');
  expect(registry.get(allTabsAtom)).toHaveLength(3);
});

test('closing tabs selects a neighbor; closing the last tab stops the host until restarted', () => {
  applyConfig(registry, payload);
  newTab(registry);
  newTab(registry);
  selectTab(registry, 2);
  closeTab(registry, 2);
  expect(registry.get(hostAtom('shell'))?.activeTabId).toBe(3);
  expect(registry.get(tabAtom(2))).toBeUndefined();
  closeTab(registry, 3);
  expect(registry.get(hostAtom('shell'))?.activeTabId).toBe(1);
  closeTab(registry, 1);
  expect(registry.get(hostAtom('shell'))?.tabIds).toEqual([]);
  expect(registry.get(hostAtom('shell'))?.activeTabId).toBeUndefined();
  expect(registry.get(sessionAtom).activeHostId).toBe('shell');
  selectHost(registry, 'shell');
  expect(registry.get(hostAtom('shell'))?.tabIds).toEqual([4]);
  expect(registry.get(hostAtom('shell'))?.activeTabId).toBe(4);
});

test('profile edits apply to new tabs, while deleting a host removes only its sessions', () => {
  applyConfig(registry, payload);
  selectHost(registry, 'local');
  const updated = {
    ...payload,
    config: {
      version: 1 as const,
      hosts: payload.config.hosts.map((host) =>
        host.id === 'local' ? { ...host, command: '/bin/bash' } : host,
      ),
      display: payload.config.display,
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
      hosts: updated.config.hosts.filter((host) => host.id !== 'local'),
      display: payload.config.display,
    },
  });
  expect(registry.get(allTabsAtom)).toHaveLength(1);
  expect(registry.get(hostAtom('local'))).toBeUndefined();
  expect(registry.get(tabAtom(2))).toBeUndefined();
  expect(registry.get(tabAtom(3))).toBeUndefined();
  expect(registry.get(sessionAtom).activeHostId).toBe('shell');
});

test('Effect Atom derived view reflects active tabs and dock indicators', () => {
  const release = registry.mount(sessionViewAtom);
  applyConfig(registry, payload);
  expect(registry.get(sessionViewAtom).runningIds.has('shell')).toBe(true);
  selectHost(registry, 'local');
  expect(registry.get(sessionViewAtom).activeTab?.hostId).toBe('local');
  expect(registry.get(sessionViewAtom).runningIds.size).toBe(2);
  closeTab(registry, registry.get(hostAtom('local'))!.activeTabId!);
  expect(registry.get(sessionViewAtom).runningIds.has('local')).toBe(false);
  release();
});

test('configuration validates IDs and commands and resolves the account shell and home', () => {
  expect(resolveLaunch(payload.config.hosts[0]!, payload.environment)).toEqual({
    command: '/bin/zsh',
    args: ['-l'],
    cwd: '/Users/test',
  });
  expect(() => parseConfig({ version: 1, hosts: [], display: { language: 'en' } })).toThrow();
  expect(() =>
    parseConfig({
      version: 1,
      hosts: [defaults.hosts[0], defaults.hosts[0]],
      display: { language: 'en' },
    }),
  ).toThrow('Duplicate');
  expect(() =>
    parseConfig({
      version: 1,
      hosts: [{ ...defaults.hosts[0], command: ' ' }],
      display: { language: 'en' },
    }),
  ).toThrow('validation.required');
});

test('SSH launch uses argv and quotes preview without interpolating a host into a shell', async () => {
  const { launchPreview } = await import('../../shared/launch');
  const profile = {
    ...payload.config.hosts[0]!,
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
    parseConfig({
      ...payload.config,
      hosts: [{ ...profile, host: '-oProxyCommand=bad' }],
    }),
  ).toThrow();
  applyConfig(registry, {
    ...payload,
    config: { version: 1, hosts: [profile], display: payload.config.display },
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
  const profile = { ...payload.config.hosts[0]!, shell: '/bin/zsh', args: [] };
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

test('host families keep their own membership and updates do not notify other hosts', () => {
  applyConfig(registry, payload);
  selectHost(registry, 'local');
  const shell = registry.get(hostAtom('shell'));
  const ids = registry.get(hostIdsAtom);
  registry.get(hostProfilesAtom);
  const shellChanged = rstest.fn();
  const idsChanged = rstest.fn();
  const profilesChanged = rstest.fn();
  const stops = [
    registry.subscribe(hostAtom('shell'), shellChanged),
    registry.subscribe(hostIdsAtom, idsChanged),
    registry.subscribe(hostProfilesAtom, profilesChanged),
  ];
  newTab(registry);
  selectTab(registry, 2);
  closeTab(registry, 3);
  expect(registry.get(hostAtom('local'))?.tabIds).toEqual([2]);
  expect(registry.get(hostAtom('local'))?.activeTabId).toBe(2);
  expect(registry.get(hostAtom('shell'))).toBe(shell);
  expect(registry.get(hostIdsAtom)).toBe(ids);
  registry.get(hostProfilesAtom);
  expect(shellChanged).not.toHaveBeenCalled();
  expect(idsChanged).not.toHaveBeenCalled();
  expect(profilesChanged).not.toHaveBeenCalled();
  expect(registry.get(sessionAtom).payload).not.toHaveProperty('config');
  expect(registry.get(sessionAtom)).not.toHaveProperty('tabs');
  expect(registry.get(sessionAtom)).not.toHaveProperty('activeTabs');
  stops.forEach((stop) => stop());
  registry.reset();
  expect(registry.get(hostIdsAtom)).toEqual([]);
  expect(registry.get(hostAtom('shell'))).toBeUndefined();
  expect(registry.get(tabAtom(2))).toBeUndefined();
});
