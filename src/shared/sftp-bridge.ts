export const SFTP_CHANNEL = 'catus:sftp';
export type SftpRequest =
  | { operation: 'connect'; destination: string }
  | { operation: 'upload'; destination: string; path: string }
  | { operation: 'download'; destination: string; path: string }
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
