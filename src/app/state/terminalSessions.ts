import type { TerminalTab } from './session';
import type { Workspace, WorkspaceEnvironment } from '../../shared/workspaces';
import type { RemoteFs, SftpHost } from '../../shared/sftp';
import * as Atom from 'effect/reactivity/Atom';

export interface TerminalHost {
  createTerminalSession(id: number, profile?: Workspace, environment?: WorkspaceEnvironment): void;
  closeTerminalSession(id: number): void;
}

// Tests can supply a host without mounting React or loading a native addon.
export const terminalHostAtom = Atom.make<(TerminalHost & Partial<SftpHost>) | undefined>(
  undefined,
);

export const terminalSessionsAtom = Atom.make((get) => {
  const configuredHost = get.once(terminalHostAtom);
  let host: TerminalHost | undefined;
  const nativeHost = () =>
    (host ??= configuredHost ?? (NativeModules.nodejs.exposed as TerminalHost));
  const sessions = new Set<number>();
  const remote = new Map<number, { connection: Promise<RemoteFs>; released: boolean }>();
  const releaseRemote = (id: number) => {
    const entry = remote.get(id);
    if (!entry) return;
    entry.released = true;
    remote.delete(id);
    // A late connection still closes if the tab disappeared during authentication.
    void entry.connection
      .then((fs) => fs.close())
      .catch((error) => console.error('Close SFTP', error));
  };
  const errors = new Map<number, string>();
  get.addFinalizer(() => {
    for (const id of sessions) nativeHost().closeTerminalSession(id);
    for (const id of remote.keys()) releaseRemote(id);
    sessions.clear();
    errors.clear();
  });
  return {
    connection(id: number) {
      const entry = remote.get(id);
      if (!entry || entry.released) return Promise.reject(new Error('SFTP tab is closed'));
      return entry.connection;
    },
    reconcile(tabs: readonly TerminalTab[], environment?: WorkspaceEnvironment) {
      const live = new Set(tabs.filter((tab) => tab.kind === 'terminal').map((tab) => tab.id));
      const remoteLive = new Set(tabs.filter((tab) => tab.kind === 'sftp').map((tab) => tab.id));
      for (const id of remote.keys()) if (!remoteLive.has(id)) releaseRemote(id);
      for (const tab of tabs) {
        if (tab.kind !== 'sftp' || remote.has(tab.id)) continue;
        const connection = Promise.resolve().then(() =>
          (nativeHost() as TerminalHost & SftpHost).connectSftp({ destination: tab.profile.host! }),
        );
        remote.set(tab.id, { connection, released: false });
        // The content observer displays failures; always attach a handler even for hidden tabs.
        void connection.catch(() => {});
      }
      for (const id of sessions) {
        if (!live.has(id)) {
          nativeHost().closeTerminalSession(id);
          sessions.delete(id);
        }
      }
      for (const id of errors.keys()) {
        if (!live.has(id)) errors.delete(id);
      }
      for (const id of live) {
        if (sessions.has(id) || errors.has(id)) continue;
        try {
          const tab = tabs.find((tab) => tab.id === id)!;
          nativeHost().createTerminalSession(id, tab.profile, environment);
          sessions.add(id);
        } catch (cause) {
          errors.set(id, String(cause) || 'Could not create terminal session');
        }
      }
      return Object.fromEntries(errors);
    },
  };
}).pipe(Atom.keepAlive);
