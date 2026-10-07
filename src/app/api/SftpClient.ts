import type { RemoteDirent, RemoteFs, RemoteStats, SftpHost } from '../../shared/sftp';
import type { SftpEntryData, SftpReply, SftpRequest, SftpStatsData } from '../../shared/sftpBridge';

type Request = <T>(request: SftpRequest) => Promise<T>;

const predicates = (type: string) => ({
  isDirectory: () => type === 'directory',
  isFile: () => type === 'file',
  isSymbolicLink: () => type === 'symlink',
});

// Renderer facade: callers work with files, while transport and wire data stay private.
export class SftpClient implements SftpHost {
  constructor(private readonly call: (request: SftpRequest) => Promise<SftpReply>) {}

  private async request<T>(args: SftpRequest): Promise<T> {
    const reply = await this.call(args);
    if (!reply.ok) {
      throw new Error(reply.error);
    }
    return reply.value as T;
  }

  uploadFiles(destination: string, path: string): Promise<boolean> {
    return this.request({ operation: 'upload', destination, path });
  }

  async connectSftp({ destination }: { destination: string }): Promise<RemoteFs> {
    const connection = await this.request<number>({ operation: 'connect', destination });
    return new SftpConnection(connection, (request) => this.request(request));
  }
}

class SftpConnection implements RemoteFs {
  constructor(
    private readonly connection: number,
    private readonly request: Request,
  ) {}

  readdir(path: string, options: { withFileTypes: true }): Promise<RemoteDirent[]>;
  readdir(path: string): Promise<string[]>;
  async readdir(
    path: string,
    options?: { withFileTypes: true },
  ): Promise<RemoteDirent[] | string[]> {
    const entries = await this.request<SftpEntryData[]>({
      operation: 'readdir',
      connection: this.connection,
      path,
    });
    return options?.withFileTypes
      ? entries.map(({ name, type }) => ({ name, ...predicates(type) }))
      : entries.map(({ name }) => name);
  }

  realpath(path: string): Promise<string> {
    return this.request({ operation: 'realpath', connection: this.connection, path });
  }

  async stat(path: string): Promise<RemoteStats> {
    const stats = await this.request<SftpStatsData>({
      operation: 'stat',
      connection: this.connection,
      path,
    });
    return { size: BigInt(stats.size), mtimeMs: stats.mtimeMs, ...predicates(stats.type) };
  }

  close(): Promise<void> {
    return this.request({ operation: 'close', connection: this.connection });
  }
}
