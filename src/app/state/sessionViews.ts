import 'background-only';
import * as Atom from 'effect/reactivity/Atom';
import { editorAtom, loadAtom, sessionAtom, sessionViewAtom, workspaceMenuAtom } from './session';

const payloadAtom = Atom.make((get) => get(sessionAtom).payload);

export const tabsViewAtom = Atom.make((get) => {
  const { tabs, activeTab, workspace } = get(sessionViewAtom);
  return {
    tabs,
    activeTabId: activeTab?.id,
    activeNumber: activeTab?.number,
    ssh: workspace?.type === 'ssh',
    loading: get(loadAtom).loading,
  };
});
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
