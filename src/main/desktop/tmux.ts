import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { quoteShell } from '../../shared/launch';
import type { TmuxSessionSummary } from '../../shared/tmux';

const execFileAsync = promisify(execFile);
// Tab-separated fields would still break on exotic session names; parse numeric
// fields from the right so the name may contain separators.
const format = '#{session_name}|#{session_windows}|#{session_attached}|#{session_activity}';
const sessionName = /^(?!-)[A-Za-z0-9._-]+$/;
const options = { timeout: 8000, maxBuffer: 1024 * 1024, encoding: 'utf8' } as const;

/** The dedicated catus server keeps managed sessions separate from user tmux work. */
export function tmuxSocket(): string {
  return process.env.CATUS_E2E_TMUX_SOCKET ?? 'catus';
}

export function parseTmuxSessions(stdout: string): TmuxSessionSummary[] {
  const sessions: TmuxSessionSummary[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    const fields = line.split('|');
    if (fields.length < 4) {
      continue;
    }
    const numbers = fields.slice(-3);
    if (!numbers.every((value) => /^\d+$/.test(value))) {
      continue;
    }
    const name = fields.slice(0, -3).join('|');
    if (!name) {
      continue;
    }
    sessions.push({
      name,
      windows: Number(numbers[0]),
      attached: Number(numbers[1]),
      activity: Number(numbers[2]),
    });
  }
  return sessions;
}

function destination(value: string): string {
  const destination = value.trim();
  if (!destination || /^[\s-]|[\r\n\0]/.test(destination)) {
    throw new Error('Enter a hostname, user@host or SSH config alias');
  }
  return destination;
}

function command(socket: string, args: readonly string[]): string {
  return ['tmux', '-L', socket, ...args].map(quoteShell).join(' ');
}

function run(destinationValue: string | undefined, args: readonly string[]) {
  const socket = tmuxSocket();
  if (destinationValue === undefined) {
    return execFileAsync('tmux', ['-L', socket, ...args], options);
  }
  return execFileAsync(
    'ssh',
    [
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=5',
      '--',
      destination(destinationValue),
      command(socket, args),
    ],
    options,
  );
}

function withoutServer(error: unknown): boolean {
  const text = String((error as { stderr?: string }).stderr ?? error);
  return /no server running|failed to connect to server|error connecting to/i.test(text);
}

export async function listTmuxSessions(destinationValue?: string) {
  try {
    const { stdout } = await run(destinationValue, ['list-sessions', '-F', format]);
    return parseTmuxSessions(stdout);
  } catch (error) {
    // No tmux server on the machine is an empty session list, not a failure.
    if (withoutServer(error)) {
      return [];
    }
    throw error;
  }
}

export async function killTmuxSession(destinationValue: string | undefined, session: string) {
  if (!sessionName.test(session)) {
    throw new Error('Invalid tmux session name');
  }
  await run(destinationValue, ['kill-session', '-t', `=${session}`]);
}
