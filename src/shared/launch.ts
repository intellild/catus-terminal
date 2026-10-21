import type { TabKind } from './tabs';
import type { TmuxSessionSummary } from './tmux';
import type { HostProfile, HostEnvironment } from './hosts';

export const defaultTmuxPrefix = 'catus-';

export function tmuxSessionName(prefix: string, index: number): string {
  return `${prefix || defaultTmuxPrefix}${index}`;
}

/** First unused `prefix + index` name, so repeated tabs add catus-0, catus-1, … */
export function nextTmuxSessionName(prefix: string, sessions: readonly string[]): string {
  const names = new Set(sessions);
  let index = 0;
  while (names.has(tmuxSessionName(prefix, index))) {
    index += 1;
  }
  return tmuxSessionName(prefix, index);
}

/** The session `tmux attach-session` picks without a target: most recently active. */
export function mostRecentTmuxSession(
  sessions: readonly TmuxSessionSummary[],
): TmuxSessionSummary | undefined {
  return sessions.reduce<TmuxSessionSummary | undefined>(
    (latest, session) => (!latest || session.activity > latest.activity ? session : latest),
    undefined,
  );
}

export function quoteShell(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

export function resolveLaunch(host: HostProfile, environment: HostEnvironment) {
  const cwd =
    host.cwd === '~'
      ? environment.home
      : host.cwd.startsWith('~/')
        ? environment.home + host.cwd.slice(1)
        : host.cwd;
  if (host.type === 'ssh') {
    const shellCommand =
      !host.shell || host.shell === '$SHELL'
        ? ''
        : host.shell === 'custom'
          ? host.command.trim()
          : `exec ${quoteShell(host.shell)} -l`;
    const remoteCommand = [host.remoteCommand?.trim(), shellCommand].filter(Boolean).join('; ');
    return {
      command: 'ssh',
      args: ['-t', '--', host.host!.trim(), ...(remoteCommand ? [remoteCommand] : [])],
      cwd,
    };
  }
  if (host.shell && host.shell !== 'custom') {
    return {
      command: host.shell === '$SHELL' ? environment.shell : host.shell,
      args: ['-l'],
      cwd,
    };
  }
  if (host.command === '$SHELL') {
    return { command: environment.shell, args: host.args, cwd };
  }
  // Legacy profiles retain their executable + argv. New command-line fields run through the shell.
  return host.args.length
    ? { command: host.command, args: host.args, cwd }
    : { command: environment.shell, args: ['-lc', host.command], cwd };
}

export function launchPreview(
  host: HostProfile,
  environment: HostEnvironment,
  kind: TabKind = host.defaultTab,
): string {
  if (kind === 'tmux') {
    const session = tmuxSessionName(host.tmuxPrefix ?? defaultTmuxPrefix, 0);
    const launch = resolveTmuxLaunch(host, environment, 1, 'catus', session);
    return [launch.program, ...launch.args].map(quoteShell).join(' ');
  }
  const launch = resolveLaunch(host, environment);
  return [launch.command, ...launch.args].map(quoteShell).join(' ');
}

// A tmux tab attaches an existing session on the target machine. Every tab joins
// tmux's most recently used session; only a machine without any session gets a
// new `prefix + index` one. Closing a tab detaches, so tmux work outlives it.
export function resolveTmuxLaunch(
  host: HostProfile,
  environment: HostEnvironment,
  tabId: number,
  socket = 'catus',
  target?: string,
) {
  const launch = resolveLaunch(host, environment);
  const session = target ?? tmuxSessionName(host.tmuxPrefix ?? defaultTmuxPrefix, 0);
  const window = `tab-${tabId}`;
  const remote = host.type === 'ssh';
  const shell =
    !host.shell || host.shell === '$SHELL'
      ? ''
      : host.shell === 'custom'
        ? host.command.trim()
        : `exec ${quoteShell(host.shell)} -l`;
  const command = remote
    ? [host.remoteCommand?.trim(), shell || (host.remoteCommand?.trim() ? 'exec "$SHELL" -l' : '')]
        .filter(Boolean)
        .join('; ')
    : [launch.command, ...launch.args].map(quoteShell).join(' ');
  // Remote ~ is expanded by tmux, not using the local account's home directory.
  const cwd = remote ? host.cwd.replace(/^~(?=\/|$)/, '#{HOME}') : launch.cwd;
  const tmux = { session, window, command, cwd };
  const base = ['tmux', '-L', socket];
  const args = [
    ...base,
    '-CC',
    'new-session',
    '-A',
    '-s',
    session,
    '-n',
    window,
    '-x',
    '80',
    '-y',
    '24',
    '-c',
    cwd,
    ...(command ? [command] : []),
  ];
  const targetName = `=${session}`;
  const check = [...base, 'has-session', '-t', targetName].map(quoteShell).join(' ');
  const attach = [...base, '-CC', 'attach-session', '-t', targetName].map(quoteShell).join(' ');
  const create = args.map(quoteShell).join(' ');
  const attachDefault = [...base, '-CC', 'attach-session'].map(quoteShell).join(' ');
  const anySession = [...base, 'list-sessions'].map(quoteShell).join(' ');
  // Probe outside control mode: a failed control-mode attach emits %error/%exit,
  // which would terminate the native protocol client before the fallback starts.
  // -A handles another tab creating the session between the probe and creation.
  const startup = target
    ? `if ${check} 2>/dev/null; then exec ${attach}; else exec ${create}; fi`
    : // No cached session list yet: keep tmux's own default target instead of failing.
      `if ${check} 2>/dev/null; then exec ${attach}; elif ${anySession} >/dev/null 2>&1; then exec ${attachDefault}; else exec ${create}; fi`;
  return remote
    ? {
        program: 'ssh',
        args: ['-tt', '--', host.host!.trim(), startup],
        cwd: launch.cwd,
        tmux,
      }
    : { program: '/bin/sh', args: ['-c', startup], cwd: launch.cwd, tmux };
}
