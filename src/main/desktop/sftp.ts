import nativeBinding from '@catus/native/lynxtron';
import type { RemoteFs } from '../../shared/sftp';

// Keep the Lynx-facing surface close to node:fs/promises, with remote connection ownership.
export async function connectSftp(options: { destination: string }): Promise<RemoteFs> {
  const connection = await nativeBinding.connectSftp(options);
  const predicates = (type: string) => ({
    isDirectory: () => type === 'directory',
    isFile: () => type === 'file',
    isSymbolicLink: () => type === 'symlink',
  });
  return {
    readdir: (async (path: string, options?: { withFileTypes: true }) => {
      const entries = await connection.readdir(path);
      return options?.withFileTypes
        ? entries.map((entry) => ({ name: entry.name, ...predicates(entry.metadata.fileType) }))
        : entries.map((entry) => entry.name);
    }) as RemoteFs['readdir'],
    realpath: (path) => connection.realpath(path),
    stat: async (path) => {
      const metadata = await connection.stat(path);
      return {
        size: metadata.size ?? 0n,
        mtimeMs: (metadata.modified ?? 0) * 1000,
        ...predicates(metadata.fileType),
      };
    },
    close: () => connection.close(),
  };
}
