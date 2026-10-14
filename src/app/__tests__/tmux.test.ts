import { expect, test } from '@rstest/core';
import { resolveTmuxLaunch } from '../../shared/launch';
import { parseWorkspaceConfig } from '../../shared/workspaces';
import defaults from '../../../tests/fixtures/workspaces.json';

const environment = { shell: '/bin/zsh', home: '/Users/test' };
const profile = parseWorkspaceConfig(defaults).workspaces[0]!;

test('local tmux tabs use a shared workspace session, stable window targets and the configured shell/cwd', () => {
  const first = resolveTmuxLaunch(
    { ...profile, tmux: true, shell: '/bin/bash', cwd: '~/my files' },
    environment,
    1,
  );
  const second = resolveTmuxLaunch({ ...profile, tmux: true }, environment, 2);
  expect(first.program).toBe('/bin/sh');
  expect(first.args[0]).toBe('-c');
  expect(first.args[1]).toContain("'has-session' '-t' '=catus'");
  expect(first.args[1]).toContain("then exec 'tmux' '-L' 'catus' '-CC' 'attach-session'");
  expect(first.args[1]).toContain("else exec 'tmux' '-L' 'catus' '-CC' 'new-session' '-A'");
  expect(first.tmux).toEqual({
    session: 'catus',
    window: 'tab-1',
    command: "'/bin/bash' '-l'",
    cwd: '/Users/test/my files',
  });
  expect(second.tmux.session).toBe(first.tmux.session);
  expect(second.tmux.window).toBe('tab-2');
});

test('SSH tmux runs on the target host and expands remote home without substituting the local home', () => {
  const launch = resolveTmuxLaunch(
    { ...profile, type: 'ssh', host: 'user@server', shell: '$SHELL', cwd: '~/work', tmux: true },
    environment,
    3,
  );
  expect(launch.program).toBe('ssh');
  expect(launch.args.slice(0, 3)).toEqual(['-tt', '--', 'user@server']);
  expect(launch.args[3]).toContain("'tmux' '-L' 'catus' '-CC'");
  expect(launch.tmux.cwd).toBe('#{HOME}/work');
  expect(launch.tmux.command).toBe('');
  const custom = resolveTmuxLaunch(
    {
      ...profile,
      type: 'ssh',
      host: 'server',
      shell: 'custom',
      command: "printf 'hello'; exec bash",
      remoteCommand: 'cd /srv',
    },
    environment,
    4,
  );
  expect(custom.tmux.command).toBe("cd /srv; printf 'hello'; exec bash");
});

test('legacy config remains valid and tmux accepts only a boolean', () => {
  expect(profile.tmux).toBeUndefined();
  expect(() =>
    parseWorkspaceConfig({ version: 1, workspaces: [{ ...profile, tmux: 'true' }] }),
  ).toThrow();
});

test('configured tmux session names override the default locally and over SSH', () => {
  const configured = { ...profile, tmux: true, tmuxSessionName: " dev team's session " };
  const local = resolveTmuxLaunch(configured, environment, 1);
  const remote = resolveTmuxLaunch({ ...configured, type: 'ssh', host: 'server' }, environment, 1);
  expect(local.tmux.session).toBe("dev team's session");
  expect(remote.tmux.session).toBe(local.tmux.session);
  expect(remote.args[3]?.split('; else')[0]).toBe(local.args[1]?.split('; else')[0]);
  expect(local.args[1]).toContain("'=dev team'\\''s session'");
});

test('tmux session names reject invalid tmux targets and protocol control characters', () => {
  for (const tmuxSessionName of [
    '',
    ' ',
    'dev.work',
    'dev:work',
    'dev\nwork',
    'dev\rwork',
    'dev\0work',
    42,
  ]) {
    expect(() =>
      parseWorkspaceConfig({ version: 1, workspaces: [{ ...profile, tmuxSessionName }] }),
    ).toThrow();
  }
});
