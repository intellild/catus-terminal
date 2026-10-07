import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export function createFileUploader(
  selectFiles: () => Promise<{ canceled: boolean; filePaths: string[] }>,
  runScp: (args: string[]) => Promise<unknown> = (args) =>
    execFileAsync('scp', args, { maxBuffer: 1024 * 1024 }),
) {
  return async (destination: string, directory: string): Promise<boolean> => {
    if (!destination.trim() || /^[\s-]|[\s\0]/.test(destination)) {
      throw new Error('Enter a hostname, user@host or SSH config alias');
    }
    if (!directory.startsWith('/') || directory.includes('\0')) {
      throw new Error('Upload requires an absolute remote directory');
    }
    const selected = await selectFiles();
    if (selected.canceled || !selected.filePaths.length) {
      return false;
    }
    // Pass arguments directly, without a shell. Modern scp uses SFTP, so remote
    // paths with spaces or shell metacharacters remain literal; do not use -O.
    await runScp([
      '-o',
      'BatchMode=yes',
      '--',
      ...selected.filePaths.map((file) => path.resolve(file)),
      `${destination}:${directory.endsWith('/') ? directory : `${directory}/`}`,
    ]);
    return true;
  };
}
