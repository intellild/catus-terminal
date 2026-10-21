import { afterEach, beforeEach, expect, rstest, test } from '@rstest/core';
import * as AtomRegistry from 'effect/reactivity/AtomRegistry';
import defaults from '../../../tests/fixtures/hosts.json';
import { parseHostsConfig } from '../../shared/hosts';
import type { HostsConfig, HostsConfigPayload } from '../../shared/hosts';
import {
  editorAtom,
  loadAtom,
  sessionAtom,
  allTabsAtom,
  tabAtom,
  hostAtom,
} from '../state/session';
import { sessionActionsAtom } from '../state/session-actions';
import type { SessionAction } from '../state/session-actions';
import { startSessionRuntime } from '../state/session-runtime';
import { terminalHostAtom } from '../state/terminal-sessions';
import { shellOptionsAtom } from '../state/shells';
import {
  tabsViewAtom,
  tabViewAtom,
  statusViewAtom,
  hostViewAtom,
  hostsViewAtom,
} from '../state/session-views';

let registry: AtomRegistry.AtomRegistry;
const payload: HostsConfigPayload = {
  config: parseHostsConfig(defaults),
  path: '/tmp/catus/hosts.json',
  environment: { shell: '/bin/zsh', home: '/Users/test' },
};
function makeHost() {
  return {
    loadHosts: rstest.fn(async () => payload),
    saveHosts: rstest.fn(async (config: HostsConfig) => ({ ...payload, config })),
    listShells: rstest.fn(async () => [{ value: '/bin/zsh', label: 'zsh' }]),
  };
}
let terminal: {
  createTerminalSession: ReturnType<typeof rstest.fn>;
  closeTerminalSession: ReturnType<typeof rstest.fn>;
};
beforeEach(() => {
  registry = AtomRegistry.make();
  terminal = { createTerminalSession: rstest.fn(), closeTerminalSession: rstest.fn() };
  registry.set(terminalHostAtom, terminal);
});
afterEach(() => registry.dispose());
function dispatch(action: SessionAction) {
  registry.set(sessionActionsAtom, action);
}
async function loaded() {
  await rstest.waitFor(() => expect(registry.get(loadAtom)).toEqual({ loading: false, error: '' }));
}

test('startup, shell detection and host actions run without React or UI subscriptions', async () => {
  const host = makeHost();
  startSessionRuntime(registry, host);
  startSessionRuntime(registry, host);
  await loaded();
  expect(host.loadHosts).toHaveBeenCalledOnce();
  expect(terminal.createTerminalSession).toHaveBeenCalledExactlyOnceWith(
    1,
    payload.config.hosts[0],
    payload.environment,
    'shell',
    undefined,
  );
  dispatch({ type: 'openHost', id: 'local' });
  dispatch({ type: 'addTab' });
  expect(registry.get(allTabsAtom).map((tab) => tab.id)).toEqual([1, 2, 3]);
  dispatch({ type: 'closeTab', id: 2 });
  expect(terminal.closeTerminalSession).toHaveBeenCalledExactlyOnceWith(2);
  dispatch({ type: 'editHost', id: 'local' });
  await rstest.waitFor(() => expect(registry.get(shellOptionsAtom).options).toHaveLength(1));
  expect(host.listShells).toHaveBeenCalledOnce();
  const tabsChanged = rstest.fn();
  const statusChanged = rstest.fn();
  const stopTabs = registry.subscribe(tabsViewAtom, tabsChanged);
  const stopStatus = registry.subscribe(statusViewAtom, statusChanged);
  dispatch({ type: 'updateDraft', field: 'name', value: 'Renamed local' });
  expect(tabsChanged).not.toHaveBeenCalled();
  expect(statusChanged).not.toHaveBeenCalled();
  stopTabs();
  stopStatus();
  dispatch({ type: 'saveDraft' });
  // Saving keeps the settings dialog open on the updated host.
  await rstest.waitFor(() => expect(host.saveHosts).toHaveBeenCalledOnce());
  expect(registry.get(editorAtom).open).toBe(true);
  expect(registry.get(editorAtom).draft?.name).toBe('Renamed local');
  expect(host.saveHosts.mock.calls[0]![0].hosts.find((host) => host.id === 'local')?.name).toBe(
    'Renamed local',
  );
  dispatch({ type: 'addTab' });
  expect(registry.get(allTabsAtom).at(-1)?.profile.name).toBe('Renamed local');
  dispatch({ type: 'deleteHost', id: 'local' });
  await rstest.waitFor(() => expect(registry.get(sessionAtom).hostIds).not.toContain('local'));
  expect(terminal.closeTerminalSession.mock.calls).toEqual([[2], [3], [4]]);
  expect(registry.get(allTabsAtom).map((tab) => tab.id)).toEqual([1]);
});

test('configuration retry cancels stale responses; disposed runtimes never create sessions', async () => {
  const host = makeHost();
  let finishOld!: (value: HostsConfigPayload) => void;
  const old = new Promise<HostsConfigPayload>((resolve) => {
    finishOld = resolve;
  });
  host.loadHosts.mockReturnValueOnce(old);
  startSessionRuntime(registry, host);
  dispatch({ type: 'reload' });
  await loaded();
  finishOld({ ...payload, config: { version: 1, hosts: [payload.config.hosts[1]!] } });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(registry.get(sessionAtom).activeHostId).toBe('shell');
  expect(terminal.createTerminalSession).toHaveBeenCalledOnce();
  host.loadHosts.mockReturnValueOnce(
    old.then(
      () =>
        new Promise<HostsConfigPayload>((resolve) => {
          finishOld = resolve;
        }),
    ),
  );
  dispatch({ type: 'reload' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  registry.dispose();
  finishOld(payload);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(terminal.createTerminalSession).toHaveBeenCalledOnce();
  expect(terminal.closeTerminalSession).toHaveBeenCalledExactlyOnceWith(1);
});

test('failed deletion preserves sessions and retries; saving blocks duplicate commands', async () => {
  const host = makeHost();
  startSessionRuntime(registry, host);
  await loaded();
  dispatch({ type: 'openHost', id: 'local' });
  host.saveHosts.mockRejectedValueOnce(new Error('Permission denied'));
  dispatch({ type: 'deleteHost', id: 'local' });
  await rstest.waitFor(() => expect(registry.get(editorAtom).error).toContain('Permission denied'));
  expect(terminal.closeTerminalSession).not.toHaveBeenCalled();
  let finishSave!: (value: HostsConfigPayload) => void;
  host.saveHosts.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishSave = resolve;
      }),
  );
  dispatch({ type: 'deleteHost', id: 'local' });
  await rstest.waitFor(() => expect(registry.get(editorAtom).saving).toBe(true));
  dispatch({ type: 'deleteHost', id: 'local' });
  dispatch({ type: 'addHost' });
  expect(host.saveHosts).toHaveBeenCalledTimes(2);
  finishSave({ ...payload, config: host.saveHosts.mock.calls[1]![0] });
  await rstest.waitFor(() =>
    expect(terminal.closeTerminalSession).toHaveBeenCalledExactlyOnceWith(2),
  );
  expect(registry.get(editorAtom).saving).toBe(false);
});

test('tab families notify only changed items; selection leaves the tab list unchanged', async () => {
  startSessionRuntime(registry, makeHost());
  await loaded();
  dispatch({ type: 'addTab' });
  dispatch({ type: 'addTab' });
  expect(tabViewAtom(1)).toBe(tabViewAtom(1));
  expect(tabViewAtom(1)).not.toBe(tabViewAtom(2));
  const items = [1, 2, 3].map((id) => ({ id, changed: rstest.fn() }));
  const stops = items.map(({ id, changed }) => {
    registry.get(tabViewAtom(id));
    return registry.subscribe(tabViewAtom(id), changed);
  });
  const listChanged = rstest.fn();
  registry.get(tabsViewAtom);
  const stopList = registry.subscribe(tabsViewAtom, listChanged);
  dispatch({ type: 'focusTab', id: 1 });
  expect(registry.get(tabViewAtom(1)).active).toBe(true);
  expect(registry.get(tabViewAtom(3)).active).toBe(false);
  expect(registry.get(tabViewAtom(2)).active).toBe(false);
  expect(items[0]!.changed).toHaveBeenCalledOnce();
  expect(items[1]!.changed).not.toHaveBeenCalled();
  expect(items[2]!.changed).toHaveBeenCalledOnce();
  expect(listChanged).not.toHaveBeenCalled();
  items.forEach(({ changed }) => changed.mockClear());
  registry.update(tabAtom(2), (tab) => ({
    ...tab!,
    profile: { ...tab!.profile, name: 'Updated tab' },
  }));
  expect(registry.get(tabViewAtom(2)).tab?.profile.name).toBe('Updated tab');
  expect(items[0]!.changed).not.toHaveBeenCalled();
  await rstest.waitFor(() => expect(items[1]!.changed).toHaveBeenCalledOnce());
  expect(items[2]!.changed).not.toHaveBeenCalled();
  expect(listChanged).not.toHaveBeenCalled();
  dispatch({ type: 'closeTab', id: 1 });
  expect(registry.get(tabViewAtom(1)).tab).toBeUndefined();
  expect(registry.get(tabsViewAtom).tabIds).toEqual([2, 3]);
  expect(terminal.closeTerminalSession).toHaveBeenCalledExactlyOnceWith(1);
  stopList();
  stops.forEach((stop) => stop());
});

test('host families notify only affected buttons; the dock subscribes to IDs only', async () => {
  startSessionRuntime(registry, makeHost());
  await loaded();
  const shellChanged = rstest.fn();
  const localChanged = rstest.fn();
  const listChanged = rstest.fn();
  registry.get(hostViewAtom('shell'));
  registry.get(hostViewAtom('local'));
  registry.get(hostsViewAtom);
  const stops = [
    registry.subscribe(hostViewAtom('shell'), shellChanged),
    registry.subscribe(hostViewAtom('local'), localChanged),
    registry.subscribe(hostsViewAtom, listChanged),
  ];
  dispatch({ type: 'addTab' });
  // Running stays true: adding tabs does not rerender the host button.
  expect(shellChanged).not.toHaveBeenCalled();
  expect(localChanged).not.toHaveBeenCalled();
  expect(listChanged).not.toHaveBeenCalled();
  registry.update(hostAtom('local'), (state) => ({
    ...state!,
    profile: { ...state!.profile, name: 'Updated host' },
  }));
  expect(localChanged).toHaveBeenCalledOnce();
  expect(shellChanged).not.toHaveBeenCalled();
  expect(listChanged).not.toHaveBeenCalled();
  localChanged.mockClear();
  dispatch({ type: 'openHost', id: 'local' });
  expect(shellChanged).toHaveBeenCalledOnce();
  expect(localChanged).toHaveBeenCalledOnce();
  expect(listChanged).not.toHaveBeenCalled();
  stops.forEach((stop) => stop());
});
