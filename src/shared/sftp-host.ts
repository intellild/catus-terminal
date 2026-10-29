import type { NativeSftpHost, RemoteFs, SftpHost } from './sftp';

const predicates = (type: string) => ({
  isDirectory: () => type === 'directory',
  isFile: () => type === 'file',
  isSymbolicLink: () => type === 'symlink',
});

// Adapts serializable N-API operations from preload to the node:fs-like surface
// used by the SFTP browser. The connection ID never leaves the background thread.
export function createSftpHost(host: () => NativeSftpHost): SftpHost {
  return {
    async connectSftp({ destination }) {
      const connection = await host().sftpConnect({ destination });
      return {
        readdir: (async (path: string, options?: { withFileTypes: true }) => {
          const entries = await host().sftpReaddir(connection, path);
          return options?.withFileTypes
            ? entries.map((entry) => ({ name: entry.name, ...predicates(entry.type) }))
            : entries.map((entry) => entry.name);
        }) as RemoteFs['readdir'],
        realpath: (path) => host().sftpRealpath(connection, path),
        stat: async (path) => {
          const stats = await host().sftpStat(connection, path);
          return { size: BigInt(stats.size), mtimeMs: stats.mtimeMs, ...predicates(stats.type) };
        },
        close: () => host().sftpClose(connection),
      };
    },
  };
}
