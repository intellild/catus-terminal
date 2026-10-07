import 'background-only';
import * as Atom from 'effect/reactivity/Atom';
import type { TerminalTab } from './session';
import {
  editorAtom,
  loadAtom,
  sessionAtom,
  sessionViewAtom,
  workspaceMenuAtom,
  activeWorkspaceAtom,
  activeWorkspaceIdAtom,
  workspaceAtom,
  tabAtom,
  allTabsAtom,
} from './session';

const payloadAtom = Atom.make((get) => get(sessionAtom).payload);

export const tabsViewAtom = Atom.make((get) => {
  const workspace = get(activeWorkspaceAtom);
  return {
    tabIds: workspace?.tabIds ?? [],
    ssh: workspace?.profile.type === 'ssh',
    loading: get(loadAtom).loading,
  };
}).pipe(
  Atom.withEquality<{ tabIds: readonly number[]; ssh: boolean; loading: boolean }>(
    (a, b) =>
      a.ssh === b.ssh &&
      a.loading === b.loading &&
      a.tabIds.length === b.tabIds.length &&
      a.tabIds.every((id, index) => id === b.tabIds[index]),
  ),
);

export const tabViewAtom = Atom.family((id: number) =>
  Atom.make((get) => {
    const tab = get(tabAtom(id));
    const workspace = tab ? get(workspaceAtom(tab.workspaceId)) : undefined;
    return {
      tab,
      active:
        !!tab && get(activeWorkspaceIdAtom) === tab.workspaceId && workspace?.activeTabId === id,
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
  const { workspace, activeTab, tabs, terminalId, terminalError } = get(sessionViewAtom);
  const load = get(loadAtom);
  return {
    workspace,
    activeTab,
    tabCount: tabs.length,
    sftpTabs: get(allTabsAtom).filter((tab) => tab.kind === 'sftp'),
    terminalId,
    terminalError,
    ...load,
  };
});
export const statusViewAtom = Atom.make((get) => {
  const { runningIds, activeTab } = get(sessionViewAtom);
  return {
    workspaceCount: runningIds.size,
    tabCount: get(allTabsAtom).length,
    hasSession: !!activeTab,
  };
});
export const settingsViewAtom = Atom.make((get) => {
  const payload = get(payloadAtom);
  return {
    editor: get(editorAtom),
    menu: get(workspaceMenuAtom),
    canDelete: get(sessionAtom).workspaceIds.length > 1,
    configPath: payload?.path,
    environment: payload?.environment,
  };
});
