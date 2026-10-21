import { i18n } from '../i18n';
import * as Atom from 'effect/reactivity/Atom';
import type { AtomRegistry } from 'effect/reactivity/AtomRegistry';
import { defaultTmuxPrefix, mostRecentTmuxSession } from '../../shared/launch';
import { terminalSessionsAtom } from './terminal-sessions';
import { tmuxDestination, tmuxSessionsAtom } from './tmux-sessions';
import type { TabKind } from '../../shared/tabs';
import type { HostProfile, HostsConfigPayload, HostFormValues } from '../../shared/hosts';

export interface TerminalTab {
  readonly id: number;
  readonly hostId: string;
  readonly kind: TabKind;
  readonly number: number;
  // Snapshot launch options: edits affect new tabs, not existing sessions.
  readonly profile: HostProfile;
  // tmux target chosen when the tab opened; undefined lets tmux attach its default.
  readonly tmuxSession?: string;
}
export interface HostState {
  readonly profile: HostProfile;
  readonly tabIds: readonly number[];
  readonly activeTabId: number | undefined;
}
export interface SessionState {
  readonly payload: Omit<HostsConfigPayload, 'config'> | null;
  readonly hostIds: readonly string[];
  readonly activeHostId: string | null;
  readonly nextTab: number;
}
export const sessionAtom = Atom.make<SessionState>({
  payload: null,
  hostIds: [],
  activeHostId: null,
  nextTab: 1,
}).pipe(Atom.keepAlive);

// Host membership is owned by each host, never inferred from tabs.
export const hostAtom = Atom.family((_id: string) =>
  Atom.make<HostState | undefined>(undefined).pipe(Atom.keepAlive),
);
export const tabAtom = Atom.family((_id: number) =>
  Atom.make<TerminalTab | undefined>(undefined).pipe(Atom.keepAlive),
);
export const terminalErrorsAtom = Atom.make<Readonly<Record<number, string>>>({}).pipe(
  Atom.keepAlive,
);
export const loadAtom = Atom.make({ loading: true, error: '' }).pipe(Atom.keepAlive);
export const hostIdsAtom = Atom.make((get) => get(sessionAtom).hostIds);
export const activeHostIdAtom = Atom.make((get) => get(sessionAtom).activeHostId);
export const activeHostAtom = Atom.make((get) => {
  const id = get(activeHostIdAtom);
  return id === null ? undefined : get(hostAtom(id));
});
export const hostProfilesAtom = Atom.make((get) =>
  get(hostIdsAtom).map((id) => get(hostAtom(id))!.profile),
).pipe(
  Atom.withEquality<readonly HostProfile[]>(
    (a, b) => a.length === b.length && a.every((profile, index) => profile === b[index]),
  ),
);
export const allTabsAtom = Atom.make((get) =>
  get(hostIdsAtom).flatMap((id) => get(hostAtom(id))!.tabIds.map((tabId) => get(tabAtom(tabId))!)),
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
  const tabs = state.hostIds.flatMap((id) =>
    store.get(hostAtom(id))!.tabIds.map((tabId) => store.get(tabAtom(tabId))!),
  );
  const errors = store.get(terminalSessionsAtom).reconcile(tabs, state.payload?.environment);
  store.set(terminalErrorsAtom, errors);
}

export function newTab(
  store: SessionAccess,
  hostId = store.get(sessionAtom).activeHostId,
  requestedKind?: TabKind,
  tmuxSession?: string,
): void {
  if (hostId === null) {
    return;
  }
  const host = store.get(hostAtom(hostId));
  if (!host) {
    return;
  }
  let kind = requestedKind ?? host.profile.defaultTab;
  if (kind === 'sftp' && host.profile.type !== 'ssh') {
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
      ? mostRecentTmuxSession(store.get(tmuxSessionsAtom(tmuxDestination(host.profile))).sessions)
          ?.name
      : tmuxSession;
  const state = store.get(sessionAtom);
  const id = state.nextTab;
  if (id > 0xffffffff) {
    throw new Error('Terminal session IDs exhausted');
  }
  Atom.batch(() => {
    store.set(tabAtom(id), {
      id,
      hostId,
      number: id,
      profile: host.profile,
      kind,
      tmuxSession: kind === 'tmux' ? target : undefined,
    });
    store.set(hostAtom(hostId), {
      ...host,
      tabIds: [...host.tabIds, id],
      activeTabId: id,
    });
    store.set(sessionAtom, { ...state, activeHostId: hostId, nextTab: id + 1 });
    reconcileSessions(store);
  });
}
export function selectHost(store: SessionAccess, id: string): void {
  const host = store.get(hostAtom(id));
  if (!host) {
    return;
  }
  if (!host.tabIds.length) {
    return newTab(store, id);
  }
  const state = store.get(sessionAtom);
  if (state.activeHostId !== id) {
    store.set(sessionAtom, { ...state, activeHostId: id });
  }
}
export function selectTab(store: SessionAccess, id: number): void {
  const tab = store.get(tabAtom(id));
  if (!tab) {
    return;
  }
  const host = store.get(hostAtom(tab.hostId));
  if (!host || !host.tabIds.includes(id)) {
    return;
  }
  Atom.batch(() => {
    if (host.activeTabId !== id) {
      store.set(hostAtom(tab.hostId), { ...host, activeTabId: id });
    }
    const state = store.get(sessionAtom);
    if (state.activeHostId !== tab.hostId) {
      store.set(sessionAtom, { ...state, activeHostId: tab.hostId });
    }
  });
}
export function closeTab(store: SessionAccess, id: number): void {
  const tab = store.get(tabAtom(id));
  if (!tab) {
    return;
  }
  const host = store.get(hostAtom(tab.hostId));
  if (!host) {
    return;
  }
  const index = host.tabIds.indexOf(id);
  const tabIds = host.tabIds.filter((tabId) => tabId !== id);
  Atom.batch(() => {
    store.set(hostAtom(tab.hostId), {
      ...host,
      tabIds,
      activeTabId:
        host.activeTabId === id ? tabIds[Math.min(index, tabIds.length - 1)] : host.activeTabId,
    });
    store.set(tabAtom(id), undefined);
    // Closing the final tab leaves the empty host selected.
    reconcileSessions(store);
  });
}
export function applyConfig(store: SessionAccess, payload: HostsConfigPayload): void {
  const state = store.get(sessionAtom);
  const hostIds = payload.config.hosts.map((host) => host.id);
  Atom.batch(() => {
    for (const id of state.hostIds) {
      if (hostIds.includes(id)) {
        continue;
      }
      const host = store.get(hostAtom(id))!;
      for (const tabId of host.tabIds) {
        store.set(tabAtom(tabId), undefined);
      }
      store.set(hostAtom(id), undefined);
    }
    for (const profile of payload.config.hosts) {
      const previous = store.get(hostAtom(profile.id));
      if (!previous) {
        store.set(hostAtom(profile.id), { profile, tabIds: [], activeTabId: undefined });
      } else if (JSON.stringify(previous.profile) !== JSON.stringify(profile)) {
        store.set(hostAtom(profile.id), { ...previous, profile });
      }
    }
    const activeHostId =
      state.activeHostId !== null && hostIds.includes(state.activeHostId)
        ? state.activeHostId
        : hostIds[0]!;
    store.set(sessionAtom, {
      ...state,
      payload: { path: payload.path, environment: payload.environment },
      hostIds:
        state.hostIds.length === hostIds.length &&
        state.hostIds.every((id, index) => id === hostIds[index])
          ? state.hostIds
          : hostIds,
      activeHostId,
    });
    if (!state.payload || activeHostId !== state.activeHostId) {
      selectHost(store, activeHostId);
    }
    reconcileSessions(store);
  });
}

export const sessionViewAtom = Atom.make((get) => {
  const current = get(activeHostAtom);
  const host = current?.profile;
  const tabs = current?.tabIds.map((id) => get(tabAtom(id))!) ?? [];
  const activeTab =
    current?.activeTabId === undefined ? undefined : get(tabAtom(current.activeTabId));
  const state = get(sessionAtom);
  const runningIds = new Set(state.hostIds.filter((id) => get(hostAtom(id))!.tabIds.length > 0));
  const errors = get(terminalErrorsAtom);
  const terminalError = activeTab ? (errors[activeTab.id] ?? '') : '';
  const terminalId = activeTab && activeTab.kind !== 'sftp' && !terminalError ? activeTab.id : 0;
  return {
    hosts: get(hostProfilesAtom),
    host,
    tabs,
    activeTab,
    runningIds,
    terminalId,
    terminalError,
  };
});

export type HostDraft = HostFormValues;
export interface EditorState {
  readonly open: boolean;
  readonly draft: HostDraft | null;
  readonly saving: boolean;
  readonly error: string;
}
export const editorAtom = Atom.make<EditorState>({
  open: false,
  draft: null,
  saving: false,
  error: '',
}).pipe(Atom.keepAlive);
export function editHost(host: HostProfile): EditorState {
  return {
    open: true,
    draft: {
      ...host,
      tmuxPrefix: host.tmuxPrefix ?? defaultTmuxPrefix,
      type: host.type ?? 'local',
      shell: host.shell ?? (host.command === '$SHELL' ? '$SHELL' : 'custom'),
      host: host.host ?? '',
      remoteCommand: host.remoteCommand ?? '',
      defaultTab: host.defaultTab,
      args: JSON.stringify(host.args),
      isNew: false,
    },
    saving: false,
    error: '',
  };
}
export function createDraft(hosts: readonly HostProfile[]): EditorState {
  let number = 1;
  while (hosts.some((host) => host.id === `host-${number}`)) {
    number += 1;
  }
  return {
    open: true,
    saving: false,
    error: '',
    draft: {
      id: `host-${number}`,
      name: i18n.t('host.newName'),
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
