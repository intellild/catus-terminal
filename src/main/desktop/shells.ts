import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { userInfo } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import type { ShellOption } from '../../shared/shells';

const execFileAsync = promisify(execFile);
// The script is constant: the destination is passed as a separate SSH argument.
const remoteProbe = 'printf "%s\\n" "$SHELL"; cat /etc/shells 2>/dev/null || true';
export function shellPaths(contents: string): string[] {
  return [...new Set(contents.split(/\r?\n/).map((line) => line.split('#')[0]!.trim()))].filter(
    (line) => line.startsWith('/') && !/[\s\0]/.test(line),
  );
}
function options(paths: readonly string[]): ShellOption[] {
  return paths.map((value) => ({ value, label: `${path.basename(value)} · ${value}` }));
}
export async function listShells(destination?: string): Promise<readonly ShellOption[]> {
  if (destination !== undefined) {
    if (!destination.trim() || /^[\s-]|[\r\n\0]/.test(destination)) {
      throw new Error('Enter a hostname, user@host or SSH config alias');
    }
    const { stdout } = await execFileAsync(
      'ssh',
      ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', '--', destination.trim(), remoteProbe],
      { timeout: 8000, maxBuffer: 64 * 1024, encoding: 'utf8' },
    );
    return options(shellPaths(stdout));
  }
  let contents = '';
  try {
    contents = await readFile('/etc/shells', 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
  const paths = shellPaths(`${userInfo().shell || process.env.SHELL || '/bin/sh'}\n${contents}`);
  const installed = await Promise.all(
    paths.map(async (value) => {
      try {
        await access(value, constants.X_OK);
        return value;
      } catch {
        return undefined;
      }
    }),
  );
  return options(installed.filter((value): value is string => value !== undefined));
}
