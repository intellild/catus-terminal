import { expect, test } from '@rstest/core';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolveTmuxLaunch } from '../../../shared/launch';
import { parseHostsConfig } from '../../../shared/hosts';
import defaults from '../../../../tests/fixtures/hosts.json';

test.skipIf(spawnSync('tmux', ['-V']).status !== 0)(
  'tmux startup attaches the default session, creates a missing one and matches exact names',
  () => {
    const socket = `catus-launch-test-${randomUUID()}`;
    const profile = {
      ...parseHostsConfig(defaults).hosts[0]!,
      shell: 'custom',
      command: '/bin/sh -i',
      args: [],
      cwd: '/tmp',
    };
    const environment = { shell: '/bin/sh', home: '/tmp' };
    const run = (...args: string[]) => {
      const result = spawnSync('tmux', ['-L', socket, ...args], { encoding: 'utf8' });
      expect(result.status, result.stderr).toBe(0);
      return result.stdout.trim();
    };
    const start = (target?: string) => {
      const launch = resolveTmuxLaunch(profile, environment, 1, socket, target);
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
      // No server: the default launch creates the prefixed session.
      start();
      const target = '=catus-0';
      const pane = run('list-panes', '-t', target, '-F', '#{pane_id}');
      expect(run('list-windows', '-t', target, '-F', '#{window_name}')).toBe('tab-1');

      // A similarly named session must not be attached by prefix matching.
      run('new-session', '-d', '-s', 'catus-0-other', '/bin/sh -i');
      start('catus-0');
      expect(run('list-panes', '-t', target, '-F', '#{pane_id}')).toBe(pane);
      expect(run('list-windows', '-t', target, '-F', '#{window_name}')).toBe('tab-1');

      // With sessions present the default launch keeps tmux's own target.
      start();
      expect(run('list-panes', '-t', target, '-F', '#{pane_id}')).toBe(pane);
    } finally {
      spawnSync('tmux', ['-L', socket, 'kill-server']);
    }
  },
);
