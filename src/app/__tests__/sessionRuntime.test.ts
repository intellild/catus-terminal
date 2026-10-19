import { afterEach, beforeEach, expect, rstest, test } from '@rstest/core';
import * as AtomRegistry from 'effect/reactivity/AtomRegistry';
import defaults from '../../../tests/fixtures/workspaces.json';
import { parseWorkspaceConfig } from '../../shared/workspaces';
import type { WorkspaceConfig, WorkspaceConfigPayload } from '../../shared/workspaces';
import {
  editorAtom,
  loadAtom,
  sessionAtom,
  allTabsAtom,
  tabAtom,
  workspaceAtom,
} from '../state/session';
import { sessionActionsAtom } from '../state/sessionActions';
import type { SessionAction } from '../state/sessionActions';
import { startSessionRuntime } from '../state/sessionRuntime';
import { terminalHostAtom } from '../state/terminalSessions';
import { shellOptionsAtom } from '../state/shells';
import {
  tabsViewAtom,
  tabViewAtom,
  statusViewAtom,
  workspaceViewAtom,
  workspacesViewAtom,
} from '../state/sessionViews';

let registry: AtomRegistry.AtomRegistry;
const payload: WorkspaceConfigPayload = {
  config: parseWorkspaceConfig(defaults),
  path: '/tmp/catus/workspaces.json',
  environment: { shell: '/bin/zsh', home: '/Users/test' },
};
function makeHost() {
  return {
    loadWorkspaces: rstest.fn(async () => payload),
    saveWorkspaces: rstest.fn(async (config: WorkspaceConfig) => ({ ...payload, config })),
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

test('startup, shell detection and workspace actions run without React or UI subscriptions', async () => {
  const host = makeHost();
  startSessionRuntime(registry, host);
  startSessionRuntime(registry, host);
  await loaded();
  expect(host.loadWorkspaces).toHaveBeenCalledOnce();
  expect(terminal.createTerminalSession).toHaveBeenCalledExactlyOnceWith(
    1,
    payload.config.workspaces[0],
    payload.environment,
    'shell',
  );
  dispatch({ type: 'openWorkspace', id: 'local' });
  dispatch({ type: 'addTab' });
  expect(registry.get(allTabsAtom).map((tab) => tab.id)).toEqual([1, 2, 3]);
  dispatch({ type: 'closeTab', id: 2 });
  expect(terminal.closeTerminalSession).toHaveBeenCalledExactlyOnceWith(2);
  dispatch({ type: 'editWorkspace', id: 'local' });
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
  await rstest.waitFor(() => expect(registry.get(editorAtom).open).toBe(false));
  expect(
    host.saveWorkspaces.mock.calls[0]![0].workspaces.find((workspace) => workspace.id === 'local')
      ?.name,
  ).toBe('Renamed local');
  dispatch({ type: 'addTab' });
  expect(registry.get(allTabsAtom).at(-1)?.profile.name).toBe('Renamed local');
  dispatch({ type: 'deleteWorkspace', id: 'local' });
  await rstest.waitFor(() => expect(registry.get(sessionAtom).workspaceIds).not.toContain('local'));
  expect(terminal.closeTerminalSession.mock.calls).toEqual([[2], [3], [4]]);
  expect(registry.get(allTabsAtom).map((tab) => tab.id)).toEqual([1]);
});

test('configuration retry cancels stale responses; disposed runtimes never create sessions', async () => {
  const host = makeHost();
  let finishOld!: (value: WorkspaceConfigPayload) => void;
  const old = new Promise<WorkspaceConfigPayload>((resolve) => {
    finishOld = resolve;
  });
  host.loadWorkspaces.mockReturnValueOnce(old);
  startSessionRuntime(registry, host);
  dispatch({ type: 'reload' });
  await loaded();
  finishOld({ ...payload, config: { version: 1, workspaces: [payload.config.workspaces[1]!] } });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(registry.get(sessionAtom).activeWorkspaceId).toBe('shell');
  expect(terminal.createTerminalSession).toHaveBeenCalledOnce();
  host.loadWorkspaces.mockReturnValueOnce(
    old.then(
      () =>
        new Promise<WorkspaceConfigPayload>((resolve) => {
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
  dispatch({ type: 'openWorkspace', id: 'local' });
  host.saveWorkspaces.mockRejectedValueOnce(new Error('Permission denied'));
  dispatch({ type: 'deleteWorkspace', id: 'local' });
  await rstest.waitFor(() => expect(registry.get(editorAtom).error).toContain('Permission denied'));
  expect(terminal.closeTerminalSession).not.toHaveBeenCalled();
  let finishSave!: (value: WorkspaceConfigPayload) => void;
  host.saveWorkspaces.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishSave = resolve;
      }),
  );
  dispatch({ type: 'deleteWorkspace', id: 'local' });
  await rstest.waitFor(() => expect(registry.get(editorAtom).saving).toBe(true));
  dispatch({ type: 'deleteWorkspace', id: 'local' });
  dispatch({ type: 'addWorkspace' });
  expect(host.saveWorkspaces).toHaveBeenCalledTimes(2);
  finishSave({ ...payload, config: host.saveWorkspaces.mock.calls[1]![0] });
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

test('workspace families notify only affected buttons; the dock subscribes to IDs only', async () => {
  startSessionRuntime(registry, makeHost());
  await loaded();
  const shellChanged = rstest.fn();
  const localChanged = rstest.fn();
  const listChanged = rstest.fn();
  registry.get(workspaceViewAtom('shell'));
  registry.get(workspaceViewAtom('local'));
  registry.get(workspacesViewAtom);
  const stops = [
    registry.subscribe(workspaceViewAtom('shell'), shellChanged),
    registry.subscribe(workspaceViewAtom('local'), localChanged),
    registry.subscribe(workspacesViewAtom, listChanged),
  ];
  dispatch({ type: 'addTab' });
  // Running stays true: adding tabs does not rerender the workspace button.
  expect(shellChanged).not.toHaveBeenCalled();
  expect(localChanged).not.toHaveBeenCalled();
  expect(listChanged).not.toHaveBeenCalled();
  registry.update(workspaceAtom('local'), (state) => ({
    ...state!,
    profile: { ...state!.profile, name: 'Updated workspace' },
  }));
  expect(localChanged).toHaveBeenCalledOnce();
  expect(shellChanged).not.toHaveBeenCalled();
  expect(listChanged).not.toHaveBeenCalled();
  localChanged.mockClear();
  dispatch({ type: 'openWorkspace', id: 'local' });
  expect(shellChanged).toHaveBeenCalledOnce();
  expect(localChanged).toHaveBeenCalledOnce();
  expect(listChanged).not.toHaveBeenCalled();
  stops.forEach((stop) => stop());
});
