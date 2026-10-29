import nativeBinding from '@catus/native/lynxtron';
import type { NativeSftpHost, SftpEntryData, SftpStatsData } from '../../shared/sftp';

type Connection = Awaited<ReturnType<typeof nativeBinding.connectSftp>>;

const connections = new Map<number, Connection>();
let nextId = 1;

function live(connection: number): Connection {
  const value = connections.get(connection);
  if (!value) {
    throw new Error('SFTP connection is closed');
  }
  return value;
}

// Preload owns the native connections and exposes serializable operations.
// Returning the connection itself would fail across ContextBridge ("no access")
// when its methods are called from BTS.
export const sftp: NativeSftpHost = {
  async sftpConnect({ destination }) {
    const connection = await nativeBinding.connectSftp({ destination });
    const id = nextId++;
    connections.set(id, connection);
    return id;
  },
  async sftpReaddir(connection: number, path: string): Promise<SftpEntryData[]> {
    const entries = await live(connection).readdir(path);
    return entries.map((entry) => ({ name: entry.name, type: entry.metadata.fileType }));
  },
  sftpRealpath(connection: number, path: string): Promise<string> {
    return live(connection).realpath(path);
  },
  async sftpStat(connection: number, path: string): Promise<SftpStatsData> {
    const stats = await live(connection).stat(path);
    return {
      size: (stats.size ?? 0n).toString(),
      mtimeMs: (stats.modified ?? 0) * 1000,
      type: stats.fileType,
    };
  },
  async sftpClose(connection: number) {
    const value = connections.get(connection);
    if (!value) {
      return;
    }
    connections.delete(connection);
    await value.close();
  },
};
