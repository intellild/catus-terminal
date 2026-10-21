import 'background-only';
import '../runtime';
import * as Atom from 'effect/reactivity/Atom';
import type { AtomRegistry } from 'effect/reactivity/AtomRegistry';
import type { TmuxSessionInfo } from '../../shared/tmux';
import { activeHostIdAtom, allTabsAtom, hostAtom } from './session';
import { terminalHostAtom, type TerminalHost } from './terminal-sessions';
import { refreshTmuxSessionsAtom, tmuxDestination, tmuxSessionsAtom } from './tmux-sessions';

const POLL_INTERVAL = 400;
// Machine-level session lists change when other tmux clients connect. SSH probes
// are relatively expensive, so the timer stays coarse and user actions refresh
// immediately through subscriptions.
const SESSIONS_POLL_INTERVAL = 10_000;

export function sameTmuxInfo(
  a: TmuxSessionInfo | undefined,
  b: TmuxSessionInfo | undefined,
): boolean {
  if (a === b) {
    return true;
  }
  if (!a || !b || a.activeWindowId !== b.activeWindowId || a.windows.length !== b.windows.length) {
    return false;
  }
  return a.windows.every((window, index) => {
    const other = b.windows[index]!;
    return (
      window.id === other.id &&
      window.index === other.index &&
      window.name === other.name &&
      window.active === other.active
    );
  });
}

function hostFrom(registry: AtomRegistry): TerminalHost | undefined {
  const configured = registry.get(terminalHostAtom);
  if (configured) {
    return configured;
  }
  return typeof NativeModules === 'undefined'
    ? undefined
    : (NativeModules.nodejs?.exposed as TerminalHost | undefined);
}

function host(get: Atom.FnContext): TerminalHost | undefined {
  return hostFrom(get.registry);
}

function snapshot(get: Atom.FnContext, id: number): TmuxSessionInfo | undefined {
  try {
    return host(get)?.getTmuxSessionInfo?.(id);
  } catch {
    // Creation and release can race the poll; the next tick retries.
    return undefined;
  }
}

// Session snapshots are keyed by native session ID and never unmounted with the
// title bar. The registry owns their lifetime; React only subscribes.
export const tmuxSessionAtom = Atom.family((_id: number) =>
  Atom.make<TmuxSessionInfo | undefined>(undefined).pipe(
    Atom.keepAlive,
    Atom.withEquality(sameTmuxInfo),
  ),
);

export type TmuxAction =
  | { type: 'selectWindow'; sessionId: number; windowId: string }
  | { type: 'createWindow'; sessionId: number }
  | { type: 'closeWindow'; sessionId: number; windowId: string };

// Window commands are registry commands; the component only dispatches them.
export const tmuxActionsAtom = Atom.fnSync<TmuxAction>()((action, get) => {
  const current = host(get);
  if (current) {
    try {
      switch (action.type) {
        case 'selectWindow':
          current.selectTmuxWindow?.(action.sessionId, action.windowId);
          break;
        case 'createWindow':
          current.createTmuxWindow?.(action.sessionId);
          break;
        case 'closeWindow':
          current.closeTmuxWindow?.(action.sessionId, action.windowId);
          break;
      }
    } catch {
      // A released session must not break the title bar.
    }
  }
  // Reflect synchronous native changes without waiting for the next poll.
  get.set(tmuxSessionAtom(action.sessionId), snapshot(get, action.sessionId));
}).pipe(Atom.keepAlive);

// One registry-owned poller for every live tmux tab, independent of React
// mount/unmount. The timer is owned by this atom's finalizer, so registry reset
// and dispose cancel it. Session release clears the family entry.
export const tmuxSyncAtom = Atom.fnSync<void>()((_, get) => {
  const registry = get.registry;
  let seen = new Set<number>();
  const refresh = () => {
    const live = new Set(
      registry
        .get(allTabsAtom)
        .filter((tab) => tab.kind === 'tmux')
        .map((tab) => tab.id),
    );
    for (const id of live) {
      registry.set(tmuxSessionAtom(id), snapshotFrom(registry, id));
    }
    for (const id of seen) {
      if (!live.has(id)) {
        registry.set(tmuxSessionAtom(id), undefined);
      }
    }
    seen = live;
  };
  refresh();
  // Tab changes are immediate; window changes inside a session use the timer.
  const unsubscribe = registry.subscribe(allTabsAtom, refresh);
  const timer = setInterval(refresh, POLL_INTERVAL);
  get.addFinalizer(() => {
    clearInterval(timer);
    unsubscribe();
  });
}).pipe(Atom.keepAlive);

function snapshotFrom(registry: AtomRegistry, id: number): TmuxSessionInfo | undefined {
  try {
    return hostFrom(registry)?.getTmuxSessionInfo?.(id);
  } catch {
    // Creation and release can race the poll; the next tick retries.
    return undefined;
  }
}

// The badge and the attach menu follow the active host's machine. Listening
// to the registry instead of React keeps the list stable across mounts.
export const tmuxSessionsViewAtom = Atom.make((get) => {
  const id = get(activeHostIdAtom);
  const profile = id === null ? undefined : get(hostAtom(id))?.profile;
  const destination = tmuxDestination(profile);
  const state = get(tmuxSessionsAtom(destination));
  return {
    destination,
    sessions: state.sessions,
    loaded: state.loaded,
    error: state.error,
  };
});

function destinationFrom(registry: AtomRegistry): string {
  const id = registry.get(activeHostIdAtom);
  return tmuxDestination(id === null ? undefined : registry.get(hostAtom(id))?.profile);
}

// One registry-owned poller for the active machine. Host switches and tab
// changes refresh immediately; the timer only catches external session changes.
export const tmuxSessionsSyncAtom = Atom.fnSync<void>()((_, get) => {
  const registry = get.registry;
  const refresh = () => registry.set(refreshTmuxSessionsAtom, destinationFrom(registry));
  refresh();
  const unsubscribeHost = registry.subscribe(activeHostIdAtom, refresh);
  const unsubscribeTabs = registry.subscribe(allTabsAtom, refresh);
  const timer = setInterval(refresh, SESSIONS_POLL_INTERVAL);
  get.addFinalizer(() => {
    clearInterval(timer);
    unsubscribeHost();
    unsubscribeTabs();
  });
}).pipe(Atom.keepAlive);
