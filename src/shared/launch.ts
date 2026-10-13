import type { Workspace, WorkspaceEnvironment } from './workspaces';

export function quoteShell(value: string): string {
  return "'" + value.replace(/'/g, "'\\''") + "'";
}

export function resolveLaunch(workspace: Workspace, environment: WorkspaceEnvironment) {
  const cwd =
    workspace.cwd === '~'
      ? environment.home
      : workspace.cwd.startsWith('~/')
        ? environment.home + workspace.cwd.slice(1)
        : workspace.cwd;
  if (workspace.type === 'ssh') {
    const shellCommand =
      !workspace.shell || workspace.shell === '$SHELL'
        ? ''
        : workspace.shell === 'custom'
          ? workspace.command.trim()
          : `exec ${quoteShell(workspace.shell)} -l`;
    const remoteCommand = [workspace.remoteCommand?.trim(), shellCommand]
      .filter(Boolean)
      .join('; ');
    return {
      command: 'ssh',
      args: ['-t', '--', workspace.host!.trim(), ...(remoteCommand ? [remoteCommand] : [])],
      cwd,
    };
  }
  if (workspace.shell && workspace.shell !== 'custom') {
    return {
      command: workspace.shell === '$SHELL' ? environment.shell : workspace.shell,
      args: ['-l'],
      cwd,
    };
  }
  if (workspace.command === '$SHELL') {
    return { command: environment.shell, args: workspace.args, cwd };
  }
  // Legacy profiles retain their executable + argv. New command-line fields run through the shell.
  return workspace.args.length
    ? { command: workspace.command, args: workspace.args, cwd }
    : { command: environment.shell, args: ['-lc', workspace.command], cwd };
}

export function launchPreview(workspace: Workspace, environment: WorkspaceEnvironment): string {
  if (workspace.tmux) {
    const launch = resolveTmuxLaunch(workspace, environment, 1);
    return [launch.program, ...launch.args].map(quoteShell).join(' ');
  }
  const launch = resolveLaunch(workspace, environment);
  return [launch.command, ...launch.args].map(quoteShell).join(' ');
}

// Stable names allow the same tabs to reconnect after an app restart. A dedicated
// socket keeps Catus sessions separate from the user's ordinary tmux server.
export function resolveTmuxLaunch(
  workspace: Workspace,
  environment: WorkspaceEnvironment,
  tabId: number,
  socket = 'catus',
) {
  const launch = resolveLaunch(workspace, environment);
  const session = `catus-${workspace.id}`;
  const window = `tab-${tabId}`;
  const remote = workspace.type === 'ssh';
  const shell =
    !workspace.shell || workspace.shell === '$SHELL'
      ? ''
      : workspace.shell === 'custom'
        ? workspace.command.trim()
        : `exec ${quoteShell(workspace.shell)} -l`;
  const command = remote
    ? [
        workspace.remoteCommand?.trim(),
        shell || (workspace.remoteCommand?.trim() ? 'exec "$SHELL" -l' : ''),
      ]
        .filter(Boolean)
        .join('; ')
    : [launch.command, ...launch.args].map(quoteShell).join(' ');
  // Remote ~ is expanded by tmux, not using the local account's home directory.
  const cwd = remote ? workspace.cwd.replace(/^~(?=\/|$)/, '#{HOME}') : launch.cwd;
  const tmux = { session, window, command, cwd };
  const args = [
    '-L',
    socket,
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
  return remote
    ? {
        program: 'ssh',
        args: ['-tt', '--', workspace.host!.trim(), ['tmux', ...args].map(quoteShell).join(' ')],
        cwd: launch.cwd,
        tmux,
      }
    : { program: 'tmux', args, cwd: launch.cwd, tmux };
}
