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
    return {
      command: 'ssh',
      args: [
        '-t',
        '--',
        workspace.host!.trim(),
        ...(workspace.remoteCommand?.trim() ? [workspace.remoteCommand.trim()] : []),
      ],
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
  const launch = resolveLaunch(workspace, environment);
  return [launch.command, ...launch.args].map(quoteShell).join(' ');
}
