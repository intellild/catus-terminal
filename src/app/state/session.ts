import * as Atom from 'effect/reactivity/Atom';
import type { Workspace, WorkspaceConfigPayload } from '../../shared/workspaces';

export interface TerminalTab {
  readonly id: string;
  readonly workspaceId: string;
  readonly number: number;
  // Snapshot launch options: edits affect new tabs, not existing sessions.
  readonly profile: Workspace;
}
export interface SessionState {
  readonly payload: WorkspaceConfigPayload | null;
  readonly activeWorkspaceId: string | null;
  readonly tabs: readonly TerminalTab[];
  readonly activeTabs: Readonly<Record<string, string>>;
  readonly nextTab: number;
}
export const emptySession: SessionState = {
  payload: null,
  activeWorkspaceId: null,
  tabs: [],
  activeTabs: {},
  nextTab: 1,
};
export const sessionAtom = Atom.make<SessionState>(emptySession).pipe(Atom.keepAlive);
export const loadAtom = Atom.make({ loading: true, error: '' }).pipe(Atom.keepAlive);

export function newTab(state: SessionState, workspaceId = state.activeWorkspaceId): SessionState {
  const profile = state.payload?.config.workspaces.find(
    (workspace) => workspace.id === workspaceId,
  );
  if (!profile) return state;
  const number = state.nextTab;
  const tab: TerminalTab = { id: `tab-${number}`, workspaceId: profile.id, number, profile };
  return {
    ...state,
    activeWorkspaceId: profile.id,
    tabs: [...state.tabs, tab],
    activeTabs: { ...state.activeTabs, [profile.id]: tab.id },
    nextTab: number + 1,
  };
}
export function selectWorkspace(state: SessionState, id: string): SessionState {
  if (!state.payload?.config.workspaces.some((workspace) => workspace.id === id)) return state;
  const tabs = state.tabs.filter((tab) => tab.workspaceId === id);
  if (!tabs.length) return newTab(state, id);
  const active = tabs.find((tab) => tab.id === state.activeTabs[id]) ?? tabs[0]!;
  return { ...state, activeWorkspaceId: id, activeTabs: { ...state.activeTabs, [id]: active.id } };
}
export function selectTab(state: SessionState, id: string): SessionState {
  const tab = state.tabs.find((tab) => tab.id === id);
  return tab
    ? {
        ...state,
        activeWorkspaceId: tab.workspaceId,
        activeTabs: { ...state.activeTabs, [tab.workspaceId]: tab.id },
      }
    : state;
}
export function closeTab(state: SessionState, id: string): SessionState {
  const tab = state.tabs.find((tab) => tab.id === id);
  if (!tab) return state;
  const workspaceTabs = state.tabs.filter((other) => other.workspaceId === tab.workspaceId);
  const index = workspaceTabs.findIndex((other) => other.id === id);
  const remaining = workspaceTabs.filter((other) => other.id !== id);
  const activeTabs = { ...state.activeTabs };
  if (activeTabs[tab.workspaceId] === id) {
    const next = remaining[Math.min(index, remaining.length - 1)];
    if (next) activeTabs[tab.workspaceId] = next.id;
    else delete activeTabs[tab.workspaceId];
  }
  // Keep the empty workspace selected so closing the final tab stays closed.
  return { ...state, tabs: state.tabs.filter((other) => other.id !== id), activeTabs };
}
export function applyConfig(state: SessionState, payload: WorkspaceConfigPayload): SessionState {
  const validIds = new Set(payload.config.workspaces.map((workspace) => workspace.id));
  const tabs = state.tabs.filter((tab) => validIds.has(tab.workspaceId));
  const activeTabs = Object.fromEntries(
    Object.entries(state.activeTabs).filter(([id]) => validIds.has(id)),
  );
  const next = { ...state, payload, tabs, activeTabs };
  if (!state.payload || !state.activeWorkspaceId || !validIds.has(state.activeWorkspaceId)) {
    return selectWorkspace(next, payload.config.workspaces[0]!.id);
  }
  return next;
}

export const sessionViewAtom = Atom.make((get) => {
  const state = get(sessionAtom);
  const workspaces = state.payload?.config.workspaces ?? [];
  const workspace = workspaces.find((item) => item.id === state.activeWorkspaceId);
  const tabs = state.tabs.filter((tab) => tab.workspaceId === workspace?.id);
  const activeTab = tabs.find((tab) => tab.id === state.activeTabs[workspace?.id ?? '']);
  const runningIds = new Set(state.tabs.map((tab) => tab.workspaceId));
  return { state, workspaces, workspace, tabs, activeTab, runningIds };
});

export interface WorkspaceDraft {
  readonly id: string;
  readonly name: string;
  readonly command: string;
  readonly args: string;
  readonly cwd: string;
  readonly icon: string;
  readonly color: string;
  readonly isNew: boolean;
}
export interface EditorState {
  readonly open: boolean;
  readonly draft: WorkspaceDraft | null;
  readonly saving: boolean;
  readonly error: string;
}
export const editorAtom = Atom.make<EditorState>({
  open: false,
  draft: null,
  saving: false,
  error: '',
}).pipe(Atom.keepAlive);
export function editWorkspace(workspace: Workspace): EditorState {
  return {
    open: true,
    draft: { ...workspace, args: JSON.stringify(workspace.args), isNew: false },
    saving: false,
    error: '',
  };
}
export function createDraft(workspaces: readonly Workspace[]): EditorState {
  let number = 1;
  while (workspaces.some((workspace) => workspace.id === `workspace-${number}`)) number += 1;
  return {
    open: true,
    saving: false,
    error: '',
    draft: {
      id: `workspace-${number}`,
      name: 'New workspace',
      command: '$SHELL',
      args: '["-l"]',
      cwd: '~',
      icon: '>_',
      color: '#a8e6cf',
      isNew: true,
    },
  };
}
