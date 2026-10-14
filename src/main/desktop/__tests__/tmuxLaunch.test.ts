import { expect, test } from '@rstest/core';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolveTmuxLaunch } from '../../../shared/launch';
import { parseWorkspaceConfig } from '../../../shared/workspaces';
import defaults from '../../../../tests/fixtures/workspaces.json';

test.skipIf(spawnSync('tmux', ['-V']).status !== 0)(
  'tmux startup creates a missing session and attaches to the exact existing session',
  () => {
    const socket = `catus-launch-test-${randomUUID()}`;
    const profile = {
      ...parseWorkspaceConfig(defaults).workspaces[0]!,
      tmux: true,
      tmuxSessionName: "dev team's session",
      shell: 'custom',
      command: '/bin/sh -i',
      args: [],
      cwd: '/tmp',
    };
    const launch = resolveTmuxLaunch(profile, { shell: '/bin/sh', home: '/tmp' }, 1, socket);
    const run = (...args: string[]) => {
      const result = spawnSync('tmux', ['-L', socket, ...args], { encoding: 'utf8' });
      expect(result.status, result.stderr).toBe(0);
      return result.stdout.trim();
    };
    const start = () => {
      // Single -C supports pipes; production -CC additionally disables PTY echo.
      const result = spawnSync(
        launch.program,
        ['-c', launch.args[1]!.replaceAll("'-CC'", "'-C'")],
        {
          input: 'detach-client\n',
          encoding: 'utf8',
          timeout: 5000,
        },
      );
      expect(result.status, result.stderr + result.stdout).toBe(0);
      expect(result.stdout).not.toContain('%error');
    };
    try {
      start();
      const target = `=${profile.tmuxSessionName}`;
      const pane = run('list-panes', '-t', target, '-F', '#{pane_id}');
      // A similarly named session must not be attached by prefix matching.
      run('new-session', '-d', '-s', `${profile.tmuxSessionName}-other`, '/bin/sh -i');
      start();
      expect(run('list-panes', '-t', target, '-F', '#{pane_id}')).toBe(pane);
      expect(run('list-windows', '-t', target, '-F', '#{window_name}')).toBe('tab-1');
    } finally {
      spawnSync('tmux', ['-L', socket, 'kill-server']);
    }
  },
);
