export interface RemoteDirent {
  readonly name: string;
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}
export interface RemoteStats {
  readonly size: bigint;
  readonly mtimeMs: number;
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): boolean;
}
export interface RemoteFs {
  readdir(path: string, options: { withFileTypes: true }): Promise<RemoteDirent[]>;
  readdir(path: string): Promise<string[]>;
  realpath(path: string): Promise<string>;
  stat(path: string): Promise<RemoteStats>;
  close(): Promise<void>;
}
export interface SftpHost {
  connectSftp(options: { destination: string }): Promise<RemoteFs>;
}
