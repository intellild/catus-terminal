import * as Atom from 'effect/reactivity/Atom';

export interface TerminalHost {
  createTerminalSession(id: number): void;
  closeTerminalSession(id: number): void;
}

// Tests can supply a host without mounting React or loading a native addon.
export const terminalHostAtom = Atom.make<TerminalHost | undefined>(undefined);

export const terminalSessionsAtom = Atom.make((get) => {
  const configuredHost = get.once(terminalHostAtom);
  let host: TerminalHost | undefined;
  const nativeHost = () =>
    (host ??= configuredHost ?? (NativeModules.nodejs.exposed as TerminalHost));
  const sessions = new Set<number>();
  const errors = new Map<number, string>();
  get.addFinalizer(() => {
    for (const id of sessions) nativeHost().closeTerminalSession(id);
    sessions.clear();
    errors.clear();
  });
  return {
    reconcile(ids: readonly number[]) {
      const live = new Set(ids);
      for (const id of sessions) {
        if (!live.has(id)) {
          nativeHost().closeTerminalSession(id);
          sessions.delete(id);
        }
      }
      for (const id of errors.keys()) {
        if (!live.has(id)) errors.delete(id);
      }
      for (const id of ids) {
        if (sessions.has(id) || errors.has(id)) continue;
        try {
          nativeHost().createTerminalSession(id);
          sessions.add(id);
        } catch (cause) {
          errors.set(id, String(cause) || 'Could not create terminal session');
        }
      }
      return Object.fromEntries(errors);
    },
  };
}).pipe(Atom.keepAlive);
