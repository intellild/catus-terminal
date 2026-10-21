import { i18n } from '../i18n';
import * as Atom from 'effect/reactivity/Atom';
import type { AtomRegistry } from 'effect/reactivity/AtomRegistry';
import { defaultTmuxPrefix, mostRecentTmuxSession } from '../../shared/launch';
import { terminalSessionsAtom } from './terminal-sessions';
import { tmuxDestination, tmuxSessionsAtom } from './tmux-sessions';
import type { TabKind } from '../../shared/tabs';
import type {
  WorkspaceSettings,
  WorkspaceConfigPayload,
  WorkspaceFormValues,
} from '../../shared/workspaces';

export interface TerminalTab {
  readonly id: number;
  readonly workspaceId: string;
  readonly kind: TabKind;
  readonly number: number;
  // Snapshot launch options: edits affect new tabs, not existing sessions.
  readonly profile: WorkspaceSettings;
  // tmux target chosen when the tab opened; undefined lets tmux attach its default.
  readonly tmuxSession?: string;
}
export interface WorkspaceState {
  readonly profile: WorkspaceSettings;
  readonly tabIds: readonly number[];
  readonly activeTabId: number | undefined;
}
export interface SessionState {
  readonly payload: Omit<WorkspaceConfigPayload, 'config'> | null;
  readonly workspaceIds: readonly string[];
  readonly activeWorkspaceId: string | null;
  readonly nextTab: number;
}
export const sessionAtom = Atom.make<SessionState>({
  payload: null,
  workspaceIds: [],
  activeWorkspaceId: null,
  nextTab: 1,
}).pipe(Atom.keepAlive);

// Workspace membership is owned by each workspace, never inferred from tabs.
export const workspaceAtom = Atom.family((_id: string) =>
  Atom.make<WorkspaceState | undefined>(undefined).pipe(Atom.keepAlive),
);
export const tabAtom = Atom.family((_id: number) =>
  Atom.make<TerminalTab | undefined>(undefined).pipe(Atom.keepAlive),
);
export const terminalErrorsAtom = Atom.make<Readonly<Record<number, string>>>({}).pipe(
  Atom.keepAlive,
);
export const loadAtom = Atom.make({ loading: true, error: '' }).pipe(Atom.keepAlive);
export const workspaceIdsAtom = Atom.make((get) => get(sessionAtom).workspaceIds);
export const activeWorkspaceIdAtom = Atom.make((get) => get(sessionAtom).activeWorkspaceId);
export const activeWorkspaceAtom = Atom.make((get) => {
  const id = get(activeWorkspaceIdAtom);
  return id === null ? undefined : get(workspaceAtom(id));
});
export const workspaceProfilesAtom = Atom.make((get) =>
  get(workspaceIdsAtom).map((id) => get(workspaceAtom(id))!.profile),
).pipe(
  Atom.withEquality<readonly WorkspaceSettings[]>(
    (a, b) => a.length === b.length && a.every((profile, index) => profile === b[index]),
  ),
);
export const allTabsAtom = Atom.make((get) =>
  get(workspaceIdsAtom).flatMap((id) =>
    get(workspaceAtom(id))!.tabIds.map((tabId) => get(tabAtom(tabId))!),
  ),
).pipe(
  Atom.withEquality<readonly TerminalTab[]>(
    (a, b) => a.length === b.length && a.every((tab, index) => tab === b[index]),
  ),
);

type SessionAccess = Pick<AtomRegistry, 'get' | 'set'>;
function reconcileSessions(store: SessionAccess) {
  const state = store.get(sessionAtom);
  // Read writable family values directly inside a batch: derived atoms may
  // retain their previous cached value until the batch flushes notifications.
  const tabs = state.workspaceIds.flatMap((id) =>
    store.get(workspaceAtom(id))!.tabIds.map((tabId) => store.get(tabAtom(tabId))!),
  );
  const errors = store.get(terminalSessionsAtom).reconcile(tabs, state.payload?.environment);
  store.set(terminalErrorsAtom, errors);
}

export function newTab(
  store: SessionAccess,
  workspaceId = store.get(sessionAtom).activeWorkspaceId,
  requestedKind?: TabKind,
  tmuxSession?: string,
): void {
  if (workspaceId === null) {
    return;
  }
  const workspace = store.get(workspaceAtom(workspaceId));
  if (!workspace) {
    return;
  }
  let kind = requestedKind ?? workspace.profile.defaultTab;
  if (kind === 'sftp' && workspace.profile.type !== 'ssh') {
    // Explicit SFTP is unavailable locally; the configured default falls back.
    if (requestedKind === 'sftp') {
      return;
    }
    kind = 'shell';
  }
  // The registry already knows the machine's sessions; attach the most recently
  // active one explicitly. Without a list the launcher keeps tmux's default target.
  const target =
    kind === 'tmux' && tmuxSession === undefined
      ? mostRecentTmuxSession(
          store.get(tmuxSessionsAtom(tmuxDestination(workspace.profile))).sessions,
        )?.name
      : tmuxSession;
  const state = store.get(sessionAtom);
  const id = state.nextTab;
  if (id > 0xffffffff) {
    throw new Error('Terminal session IDs exhausted');
  }
  Atom.batch(() => {
    store.set(tabAtom(id), {
      id,
      workspaceId,
      number: id,
      profile: workspace.profile,
      kind,
      tmuxSession: kind === 'tmux' ? target : undefined,
    });
    store.set(workspaceAtom(workspaceId), {
      ...workspace,
      tabIds: [...workspace.tabIds, id],
      activeTabId: id,
    });
    store.set(sessionAtom, { ...state, activeWorkspaceId: workspaceId, nextTab: id + 1 });
    reconcileSessions(store);
  });
}
export function selectWorkspace(store: SessionAccess, id: string): void {
  const workspace = store.get(workspaceAtom(id));
  if (!workspace) {
    return;
  }
  if (!workspace.tabIds.length) {
    return newTab(store, id);
  }
  const state = store.get(sessionAtom);
  if (state.activeWorkspaceId !== id) {
    store.set(sessionAtom, { ...state, activeWorkspaceId: id });
  }
}
export function selectTab(store: SessionAccess, id: number): void {
  const tab = store.get(tabAtom(id));
  if (!tab) {
    return;
  }
  const workspace = store.get(workspaceAtom(tab.workspaceId));
  if (!workspace || !workspace.tabIds.includes(id)) {
    return;
  }
  Atom.batch(() => {
    if (workspace.activeTabId !== id) {
      store.set(workspaceAtom(tab.workspaceId), { ...workspace, activeTabId: id });
    }
    const state = store.get(sessionAtom);
    if (state.activeWorkspaceId !== tab.workspaceId) {
      store.set(sessionAtom, { ...state, activeWorkspaceId: tab.workspaceId });
    }
  });
}
export function closeTab(store: SessionAccess, id: number): void {
  const tab = store.get(tabAtom(id));
  if (!tab) {
    return;
  }
  const workspace = store.get(workspaceAtom(tab.workspaceId));
  if (!workspace) {
    return;
  }
  const index = workspace.tabIds.indexOf(id);
  const tabIds = workspace.tabIds.filter((tabId) => tabId !== id);
  Atom.batch(() => {
    store.set(workspaceAtom(tab.workspaceId), {
      ...workspace,
      tabIds,
      activeTabId:
        workspace.activeTabId === id
          ? tabIds[Math.min(index, tabIds.length - 1)]
          : workspace.activeTabId,
    });
    store.set(tabAtom(id), undefined);
    // Closing the final tab leaves the empty workspace selected.
    reconcileSessions(store);
  });
}
export function applyConfig(store: SessionAccess, payload: WorkspaceConfigPayload): void {
  const state = store.get(sessionAtom);
  const workspaceIds = payload.config.workspaces.map((workspace) => workspace.id);
  Atom.batch(() => {
    for (const id of state.workspaceIds) {
      if (workspaceIds.includes(id)) {
        continue;
      }
      const workspace = store.get(workspaceAtom(id))!;
      for (const tabId of workspace.tabIds) {
        store.set(tabAtom(tabId), undefined);
      }
      store.set(workspaceAtom(id), undefined);
    }
    for (const profile of payload.config.workspaces) {
      const previous = store.get(workspaceAtom(profile.id));
      if (!previous) {
        store.set(workspaceAtom(profile.id), { profile, tabIds: [], activeTabId: undefined });
      } else if (JSON.stringify(previous.profile) !== JSON.stringify(profile)) {
        store.set(workspaceAtom(profile.id), { ...previous, profile });
      }
    }
    const activeWorkspaceId =
      state.activeWorkspaceId !== null && workspaceIds.includes(state.activeWorkspaceId)
        ? state.activeWorkspaceId
        : workspaceIds[0]!;
    store.set(sessionAtom, {
      ...state,
      payload: { path: payload.path, environment: payload.environment },
      workspaceIds:
        state.workspaceIds.length === workspaceIds.length &&
        state.workspaceIds.every((id, index) => id === workspaceIds[index])
          ? state.workspaceIds
          : workspaceIds,
      activeWorkspaceId,
    });
    if (!state.payload || activeWorkspaceId !== state.activeWorkspaceId) {
      selectWorkspace(store, activeWorkspaceId);
    }
    reconcileSessions(store);
  });
}

export const sessionViewAtom = Atom.make((get) => {
  const current = get(activeWorkspaceAtom);
  const workspace = current?.profile;
  const tabs = current?.tabIds.map((id) => get(tabAtom(id))!) ?? [];
  const activeTab =
    current?.activeTabId === undefined ? undefined : get(tabAtom(current.activeTabId));
  const state = get(sessionAtom);
  const runningIds = new Set(
    state.workspaceIds.filter((id) => get(workspaceAtom(id))!.tabIds.length > 0),
  );
  const errors = get(terminalErrorsAtom);
  const terminalError = activeTab ? (errors[activeTab.id] ?? '') : '';
  const terminalId = activeTab && activeTab.kind !== 'sftp' && !terminalError ? activeTab.id : 0;
  return {
    workspaces: get(workspaceProfilesAtom),
    workspace,
    tabs,
    activeTab,
    runningIds,
    terminalId,
    terminalError,
  };
});

export type WorkspaceDraft = WorkspaceFormValues;
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
export function editWorkspace(workspace: WorkspaceSettings): EditorState {
  return {
    open: true,
    draft: {
      ...workspace,
      tmuxPrefix: workspace.tmuxPrefix ?? defaultTmuxPrefix,
      type: workspace.type ?? 'local',
      shell: workspace.shell ?? (workspace.command === '$SHELL' ? '$SHELL' : 'custom'),
      host: workspace.host ?? '',
      remoteCommand: workspace.remoteCommand ?? '',
      defaultTab: workspace.defaultTab,
      args: JSON.stringify(workspace.args),
      isNew: false,
    },
    saving: false,
    error: '',
  };
}
export function createDraft(workspaces: readonly WorkspaceSettings[]): EditorState {
  let number = 1;
  while (workspaces.some((workspace) => workspace.id === `workspace-${number}`)) {
    number += 1;
  }
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
      defaultTab: 'shell',
      command: '$SHELL',
      shell: '$SHELL',
      args: '["-l"]',
      cwd: '~',
      icon: '>_',
      color: '#a8e6cf',
      tmuxPrefix: defaultTmuxPrefix,
      isNew: true,
    },
  };
}
