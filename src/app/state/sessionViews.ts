import 'background-only';
import * as Atom from 'effect/reactivity/Atom';
import type { TerminalTab } from './session';
import { editorAtom, loadAtom, sessionAtom, sessionViewAtom, workspaceMenuAtom } from './session';

const payloadAtom = Atom.make((get) => get(sessionAtom).payload);

export const tabsViewAtom = Atom.make((get) => {
  const state = get(sessionAtom);
  const workspace = state.payload?.config.workspaces.find(
    (workspace) => workspace.id === state.activeWorkspaceId,
  );
  return {
    tabIds: state.tabs.filter((tab) => tab.workspaceId === workspace?.id).map((tab) => tab.id),
    ssh: workspace?.type === 'ssh',
    loading: get(loadAtom).loading,
  };
}).pipe(
  Atom.withEquality<{ tabIds: number[]; ssh: boolean; loading: boolean }>(
    (a, b) =>
      a.ssh === b.ssh &&
      a.loading === b.loading &&
      a.tabIds.length === b.tabIds.length &&
      a.tabIds.every((id, index) => id === b.tabIds[index]),
  ),
);

export const tabViewAtom = Atom.family((id: number) =>
  Atom.make((get) => {
    const state = get(sessionAtom);
    const tab = state.tabs.find((tab) => tab.id === id);
    return {
      tab,
      active:
        !!tab &&
        state.activeWorkspaceId === tab.workspaceId &&
        state.activeTabs[tab.workspaceId] === id,
    };
  }).pipe(
    Atom.withEquality<{ tab: TerminalTab | undefined; active: boolean }>(
      (a, b) => a.tab === b.tab && a.active === b.active,
    ),
  ),
);

export const workspacesViewAtom = Atom.make((get) => {
  const { workspaces, workspace, runningIds } = get(sessionViewAtom);
  return {
    workspaces,
    activeWorkspaceId: workspace?.id,
    runningIds,
    loading: get(loadAtom).loading,
  };
});
export const contentViewAtom = Atom.make((get) => {
  const { workspace, activeTab, tabs, state, terminalId, terminalError } = get(sessionViewAtom);
  const load = get(loadAtom);
  return {
    workspace,
    activeTab,
    tabCount: tabs.length,
    sftpTabs: state.tabs.filter((tab) => tab.kind === 'sftp'),
    terminalId,
    terminalError,
    ...load,
  };
});
export const statusViewAtom = Atom.make((get) => {
  const { runningIds, state, activeTab } = get(sessionViewAtom);
  return { workspaceCount: runningIds.size, tabCount: state.tabs.length, hasSession: !!activeTab };
});
export const settingsViewAtom = Atom.make((get) => {
  const payload = get(payloadAtom);
  return {
    editor: get(editorAtom),
    menu: get(workspaceMenuAtom),
    canDelete: (payload?.config.workspaces.length ?? 0) > 1,
    configPath: payload?.path,
    environment: payload?.environment,
  };
});
