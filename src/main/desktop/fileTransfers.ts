import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const runScp = (args: string[]): Promise<unknown> =>
  execFileAsync('scp', args, { maxBuffer: 1024 * 1024 });

function validateRemote(destination: string, remotePath: string) {
  if (!destination.trim() || /^[\s-]|[\s\0]/.test(destination)) {
    throw new Error('Enter a hostname, user@host or SSH config alias');
  }
  if (!remotePath.startsWith('/') || remotePath.includes('\0')) {
    throw new Error('File transfer requires an absolute remote path');
  }
}

export function createFileUploader(
  selectFiles: () => Promise<{ canceled: boolean; filePaths: string[] }>,
  execute: (args: string[]) => Promise<unknown> = runScp,
) {
  return async (destination: string, directory: string): Promise<boolean> => {
    validateRemote(destination, directory);
    const selected = await selectFiles();
    if (selected.canceled || !selected.filePaths.length) {
      return false;
    }
    // Pass arguments directly, without a shell. Modern scp uses SFTP, so remote
    // paths with spaces or shell metacharacters remain literal; do not use -O.
    await execute([
      '-o',
      'BatchMode=yes',
      '--',
      ...selected.filePaths.map((file) => path.resolve(file)),
      `${destination}:${directory.endsWith('/') ? directory : `${directory}/`}`,
    ]);
    return true;
  };
}

export function createFileDownloader(
  selectSavePath: (filename: string) => Promise<{ canceled: boolean; filePath?: string }>,
  execute: (args: string[]) => Promise<unknown> = runScp,
) {
  return async (destination: string, remotePath: string): Promise<boolean> => {
    validateRemote(destination, remotePath);
    const selected = await selectSavePath(path.posix.basename(remotePath));
    if (selected.canceled || !selected.filePath) {
      return false;
    }
    // scp expands remote source globs even in SFTP mode. Escape the pattern
    // characters so downloading one filename cannot match other files.
    const source = remotePath.replace(/[\\*?[\]]/g, '\\$&');
    await execute([
      '-o',
      'BatchMode=yes',
      '--',
      `${destination}:${source}`,
      path.resolve(selected.filePath),
    ]);
    return true;
  };
}
