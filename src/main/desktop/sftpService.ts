import type { RemoteFs, SftpHost } from '../../shared/sftp';
import type { SftpReply, SftpRequest } from '../../shared/sftpBridge';

const fileType = (entry: {
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}) =>
  entry.isDirectory()
    ? 'directory'
    : entry.isFile()
      ? 'file'
      : entry.isSymbolicLink()
        ? 'symlink'
        : 'other';

// Only the Node main environment creates N-API objects and receives their Promise completions.
export function createSftpService(
  connect: SftpHost['connectSftp'],
  uploadFiles?: (destination: string, path: string) => Promise<boolean>,
) {
  const connections = new Map<number, RemoteFs>();
  let nextId = 1;
  let disposed = false;
  return {
    async handle(request: SftpRequest): Promise<SftpReply> {
      try {
        if (disposed) {
          throw new Error('SFTP service is closed');
        }
        if (request.operation === 'upload') {
          if (!uploadFiles) {
            throw new Error('File upload is unavailable');
          }
          return { ok: true, value: await uploadFiles(request.destination, request.path) };
        }
        if (request.operation === 'connect') {
          const fs = await connect({ destination: request.destination });
          if (disposed) {
            await fs.close();
            throw new Error('SFTP service is closed');
          }
          const id = nextId++;
          connections.set(id, fs);
          return { ok: true, value: id };
        }
        const fs = connections.get(request.connection);
        if (request.operation === 'close') {
          connections.delete(request.connection);
          await fs?.close();
          return { ok: true, value: null };
        }
        if (!fs) {
          throw new Error('SFTP connection is closed');
        }
        switch (request.operation) {
          case 'readdir': {
            const entries = await fs.readdir(request.path, { withFileTypes: true });
            return {
              ok: true,
              value: entries.map((entry) => ({ name: entry.name, type: fileType(entry) })),
            };
          }
          case 'realpath':
            return { ok: true, value: await fs.realpath(request.path) };
          case 'stat': {
            const stats = await fs.stat(request.path);
            return {
              ok: true,
              value: { size: stats.size.toString(), mtimeMs: stats.mtimeMs, type: fileType(stats) },
            };
          }
        }
      } catch (error) {
        // lynxBridge.handle does not relay rejected Promises; always send an explicit reply.
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
    async dispose() {
      disposed = true;
      const pending = [...connections.values()];
      connections.clear();
      await Promise.allSettled(pending.map((fs) => fs.close()));
    },
  };
}
