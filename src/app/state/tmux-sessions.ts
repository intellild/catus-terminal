import 'background-only';
import '../runtime';
import * as Atom from 'effect/reactivity/Atom';
import * as Effect from 'effect/Effect';
import type { TmuxSessionHost, TmuxSessionSummary } from '../../shared/tmux';
import { hostServiceAtom } from './host-service';

export interface TmuxSessionsState {
  readonly sessions: readonly TmuxSessionSummary[];
  readonly loaded: boolean;
  readonly pending: boolean;
  readonly error: string;
}

const empty: TmuxSessionsState = { sessions: [], loaded: false, pending: false, error: '' };

/** The machine a host's tmux sessions live on: the SSH host or the local machine. */
export function tmuxDestination(profile?: { type?: string; host?: string }): string {
  return profile?.type === 'ssh' ? (profile.host ?? '').trim() : '';
}

function sameSessions(a: readonly TmuxSessionSummary[], b: readonly TmuxSessionSummary[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (session, index) =>
        session.name === b[index]!.name &&
        session.windows === b[index]!.windows &&
        session.attached === b[index]!.attached,
    )
  );
}

// One entry per SSH destination ('' is the local machine). The registry owns
// the list; the badge and the session menu only subscribe to it.
export const tmuxSessionsAtom = Atom.family((_destination: string) =>
  Atom.make<TmuxSessionsState>(empty).pipe(
    Atom.keepAlive,
    Atom.withEquality<TmuxSessionsState>(
      (a, b) =>
        a.loaded === b.loaded &&
        a.pending === b.pending &&
        a.error === b.error &&
        sameSessions(a.sessions, b.sessions),
    ),
  ),
);

function sessionHost(
  get: Atom.FnContext,
): (TmuxSessionHost & { listShells?: unknown }) | undefined {
  const configured = get(hostServiceAtom);
  if (configured) {
    return configured;
  }
  return typeof NativeModules === 'undefined'
    ? undefined
    : (NativeModules.nodejs?.exposed as TmuxSessionHost | undefined);
}

function update(get: Atom.FnContext, destination: string, value: Partial<TmuxSessionsState>) {
  get.set(tmuxSessionsAtom(destination), { ...get(tmuxSessionsAtom(destination)), ...value });
}

// `destination` is the SSH host or '' for the local machine. Concurrent polls
// are skipped so a slow SSH probe cannot pile up.
export const refreshTmuxSessionsAtom = Atom.fn<string>()((destination, get) =>
  Effect.gen(function* () {
    if (get(tmuxSessionsAtom(destination)).pending) {
      return;
    }
    const host = sessionHost(get);
    update(get, destination, { pending: true });
    if (!host?.listTmuxSessions) {
      update(get, destination, { pending: false, loaded: true, sessions: [] });
      return;
    }
    const result = yield* Effect.tryPromise(() =>
      host.listTmuxSessions!(destination === '' ? undefined : destination),
    ).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          update(get, destination, { pending: false, loaded: true, error: String(error) });
          return undefined;
        }),
      ),
    );
    if (result) {
      update(get, destination, { pending: false, loaded: true, error: '', sessions: result });
    }
  }),
).pipe(Atom.keepAlive);

// Closing a session is explicit user intent: tab close only detaches.
export const closeTmuxSessionAtom = Atom.fn<{ destination: string; session: string }>()(
  ({ destination, session }, get) =>
    Effect.gen(function* () {
      const host = sessionHost(get);
      if (host?.killTmuxSession) {
        yield* Effect.tryPromise(() =>
          host.killTmuxSession!(destination === '' ? undefined : destination, session),
        ).pipe(Effect.catch(() => Effect.void));
      }
      get.set(refreshTmuxSessionsAtom, destination);
    }),
).pipe(Atom.keepAlive);
