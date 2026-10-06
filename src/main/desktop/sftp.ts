import nativeBinding from '@catus/native/lynxtron';
import type { RemoteFs } from '../../shared/sftp';
import { promisify } from 'node:util';

const connect = promisify(nativeBinding.connectSftp.bind(nativeBinding));

// Keep the Lynx-facing surface close to node:fs/promises, with remote connection ownership.
export async function connectSftp(options: { destination: string }): Promise<RemoteFs> {
  const connection = await connect(options);
  // Bound methods retain the native receiver; unbound napi-rs class methods cannot be called.
  const readdir = promisify(connection.readdir.bind(connection));
  const realpath = promisify(connection.realpath.bind(connection));
  const stat = promisify(connection.stat.bind(connection));
  const close = promisify(connection.close.bind(connection));
  const predicates = (type: string) => ({
    isDirectory: () => type === 'directory',
    isFile: () => type === 'file',
    isSymbolicLink: () => type === 'symlink',
  });
  return {
    readdir: (async (path: string, options?: { withFileTypes: true }) => {
      const entries = await readdir(path);
      return options?.withFileTypes
        ? entries.map((entry) => ({ name: entry.name, ...predicates(entry.metadata.fileType) }))
        : entries.map((entry) => entry.name);
    }) as RemoteFs['readdir'],
    realpath,
    stat: async (path) => {
      const metadata = await stat(path);
      return {
        size: metadata.size ?? 0n,
        mtimeMs: (metadata.modified ?? 0) * 1000,
        ...predicates(metadata.fileType),
      };
    },
    close,
  };
}
