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

export interface SftpEntryData {
  readonly name: string;
  readonly type: string;
}
export interface SftpStatsData {
  readonly size: string;
  readonly mtimeMs: number;
  readonly type: string;
}

// ContextBridge cannot return functions that close over a native connection
// object (V8 rejects them with "no access"). Preload therefore keeps the
// connection table and exposes serializable operations keyed by connection ID.
export interface NativeSftpHost {
  sftpConnect(options: { destination: string }): Promise<number>;
  sftpReaddir(connection: number, path: string): Promise<SftpEntryData[]>;
  sftpRealpath(connection: number, path: string): Promise<string>;
  sftpStat(connection: number, path: string): Promise<SftpStatsData>;
  sftpClose(connection: number): Promise<void>;
}

// Uploads and downloads stay in main because native file dialogs and scp are
// main-process capabilities.
export const FILE_TRANSFER_CHANNEL = 'catus:file-transfer';
export type FileTransferRequest =
  | { operation: 'upload'; destination: string; path: string }
  | { operation: 'download'; destination: string; path: string };
export type FileTransferReply = { ok: true; value: boolean } | { ok: false; error: string };
