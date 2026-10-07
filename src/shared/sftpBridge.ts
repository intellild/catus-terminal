import type { RemoteFs, SftpHost } from './sftp';

export const SFTP_CHANNEL = 'catus:sftp';
export type SftpRequest =
  | { operation: 'connect'; destination: string }
  | { operation: 'readdir' | 'realpath' | 'stat'; connection: number; path: string }
  | { operation: 'close'; connection: number };
export type SftpReply = { ok: true; value: unknown } | { ok: false; error: string };
export interface SftpEntryData {
  name: string;
  type: string;
}
export interface SftpStatsData {
  size: string;
  mtimeMs: number;
  type: string;
}

// The bridge carries JSON data. Native objects, bigint and predicates stay on their own thread.
export function createSftpBridgeHost(call: (request: SftpRequest) => Promise<SftpReply>): SftpHost {
  async function request<T>(args: SftpRequest): Promise<T> {
    const reply = await call(args);
    if (!reply.ok) {
      throw new Error(reply.error);
    }
    return reply.value as T;
  }
  const predicates = (type: string) => ({
    isDirectory: () => type === 'directory',
    isFile: () => type === 'file',
    isSymbolicLink: () => type === 'symlink',
  });
  return {
    async connectSftp({ destination }) {
      const connection = await request<number>({ operation: 'connect', destination });
      return {
        readdir: (async (path: string, options?: { withFileTypes: true }) => {
          const entries = await request<SftpEntryData[]>({
            operation: 'readdir',
            connection,
            path,
          });
          return options?.withFileTypes
            ? entries.map(({ name, type }) => ({ name, ...predicates(type) }))
            : entries.map(({ name }) => name);
        }) as RemoteFs['readdir'],
        realpath: (path) => request<string>({ operation: 'realpath', connection, path }),
        stat: async (path) => {
          const stats = await request<SftpStatsData>({ operation: 'stat', connection, path });
          return { size: BigInt(stats.size), mtimeMs: stats.mtimeMs, ...predicates(stats.type) };
        },
        close: () => request<void>({ operation: 'close', connection }),
      };
    },
  };
}
