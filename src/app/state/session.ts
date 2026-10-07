import { i18n } from '../i18n';
import * as Atom from 'effect/reactivity/Atom';
import { terminalSessionsAtom } from './terminalSessions';
import type { Workspace, WorkspaceConfigPayload } from '../../shared/workspaces';

export interface TerminalTab {
  readonly id: number;
  readonly workspaceId: string;
  readonly kind: 'terminal' | 'sftp';
  readonly number: number;
  // Snapshot launch options: edits affect new tabs, not existing sessions.
  readonly profile: Workspace;
}
export interface SessionState {
  readonly payload: WorkspaceConfigPayload | null;
  readonly activeWorkspaceId: string | null;
  readonly tabs: readonly TerminalTab[];
  readonly activeTabs: Readonly<Record<string, number>>;
  readonly nextTab: number;
  readonly terminalErrors: Readonly<Record<number, string>>;
}
export const emptySession: SessionState = {
  payload: null,
  activeWorkspaceId: null,
  tabs: [],
  activeTabs: {},
  nextTab: 1,
  terminalErrors: {},
};
// Every write reconciles native ownership before publishing the next UI state.
export const sessionAtom = Atom.writable<SessionState, SessionState>(
  (get) => {
    get.mount(terminalSessionsAtom);
    return emptySession;
  },
  (get, state) => {
    const terminalErrors = get
      .get(terminalSessionsAtom)
      .reconcile(state.tabs, state.payload?.environment);
    get.setSelf({ ...state, terminalErrors });
  },
).pipe(Atom.keepAlive);
export const loadAtom = Atom.make({ loading: true, error: '' }).pipe(Atom.keepAlive);

export function newTab(
  state: SessionState,
  workspaceId = state.activeWorkspaceId,
  kind: TerminalTab['kind'] = 'terminal',
): SessionState {
  const profile = state.payload?.config.workspaces.find(
    (workspace) => workspace.id === workspaceId,
  );
  if (!profile || (kind === 'sftp' && profile.type !== 'ssh')) return state;
  const number = state.nextTab;
  if (number > 0xffffffff) throw new Error('Terminal session IDs exhausted');
  const tab: TerminalTab = { id: number, workspaceId: profile.id, number, profile, kind };
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
export function selectTab(state: SessionState, id: number): SessionState {
  const tab = state.tabs.find((tab) => tab.id === id);
  return tab
    ? {
        ...state,
        activeWorkspaceId: tab.workspaceId,
        activeTabs: { ...state.activeTabs, [tab.workspaceId]: tab.id },
      }
    : state;
}
export function closeTab(state: SessionState, id: number): SessionState {
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
  const terminalError = activeTab ? (state.terminalErrors[activeTab.id] ?? '') : '';
  const terminalId = activeTab?.kind === 'terminal' && !terminalError ? activeTab.id : 0;
  return { state, workspaces, workspace, tabs, activeTab, runningIds, terminalId, terminalError };
});

export interface WorkspaceDraft {
  readonly id: string;
  readonly name: string;
  readonly command: string;
  readonly shell: string;
  readonly type: 'local' | 'ssh';
  readonly host: string;
  readonly remoteCommand: string;
  readonly args: string;
  readonly cwd: string;
  readonly icon: string;
  readonly color: string;
  readonly isNew: boolean;
}
export interface EditorState {
  readonly open: boolean;
  readonly draft: WorkspaceDraft | null;
  readonly fieldErrors?: Readonly<Record<string, string>>;
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
    draft: {
      ...workspace,
      type: workspace.type ?? 'local',
      shell: workspace.shell ?? (workspace.command === '$SHELL' ? '$SHELL' : 'custom'),
      host: workspace.host ?? '',
      remoteCommand: workspace.remoteCommand ?? '',
      args: JSON.stringify(workspace.args),
      isNew: false,
    },
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
      name: i18n.t('workspace.newName'),
      type: 'local',
      host: '',
      remoteCommand: '',
      command: '$SHELL',
      shell: '$SHELL',
      args: '["-l"]',
      cwd: '~',
      icon: '>_',
      color: '#a8e6cf',
      isNew: true,
    },
  };
}

export const workspaceMenuAtom = Atom.make<{ id: string; x: number; y: number } | null>(null).pipe(
  Atom.keepAlive,
);
