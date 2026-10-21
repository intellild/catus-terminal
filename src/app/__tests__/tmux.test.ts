import { expect, test } from '@rstest/core';
import {
  launchPreview,
  mostRecentTmuxSession,
  nextTmuxSessionName,
  resolveTmuxLaunch,
} from '../../shared/launch';
import { parseConfig } from '../../shared/config';
import defaults from '../../../tests/fixtures/config.json';

const environment = { shell: '/bin/zsh', home: '/Users/test' };
const profile = parseConfig(defaults).hosts[0]!;

test('a tmux tab attaches the machine default and only creates a session when none exists', () => {
  const first = resolveTmuxLaunch(
    { ...profile, shell: '/bin/bash', cwd: '~/my files' },
    environment,
    1,
  );
  expect(first.program).toBe('/bin/sh');
  expect(first.args[0]).toBe('-c');
  // Without a known session tmux picks its default target and creates catus-0 only when empty.
  expect(first.args[1]).toContain("'has-session' '-t' '=catus-0'");
  expect(first.args[1]).toContain("elif 'tmux' '-L' 'catus' 'list-sessions'");
  expect(first.args[1]).toContain("then exec 'tmux' '-L' 'catus' '-CC' 'attach-session'");
  expect(first.args[1]).toContain("else exec 'tmux' '-L' 'catus' '-CC' 'new-session' '-A'");
  expect(first.tmux).toEqual({
    session: 'catus-0',
    window: 'tab-1',
    command: "'/bin/bash' '-l'",
    cwd: '/Users/test/my files',
  });

  // An explicit target from the session menu attaches that exact session.
  const chosen = resolveTmuxLaunch(profile, environment, 2, undefined, 'work');
  expect(chosen.args[1]).toContain("'has-session' '-t' '=work'");
  expect(chosen.args[1]).not.toContain('elif');
  expect(chosen.tmux).toMatchObject({ session: 'work', window: 'tab-2' });

  const custom = resolveTmuxLaunch({ ...profile, tmuxPrefix: 'dev-' }, environment, 3);
  expect(custom.tmux.session).toBe('dev-0');
});

test('session names increment from the host prefix and reuse free indexes', () => {
  expect(nextTmuxSessionName('catus-', [])).toBe('catus-0');
  expect(nextTmuxSessionName('catus-', ['catus-0', 'catus-2'])).toBe('catus-1');
  expect(nextTmuxSessionName('dev-', ['other', 'dev-0'])).toBe('dev-1');
  expect(nextTmuxSessionName('', [])).toBe('catus-0');
  expect(
    mostRecentTmuxSession([
      { name: 'idle', windows: 1, attached: 0, activity: 5 },
      { name: 'recent', windows: 2, attached: 1, activity: 9 },
    ])?.name,
  ).toBe('recent');
  expect(mostRecentTmuxSession([])).toBeUndefined();
});

test('SSH tmux runs on the target host and expands remote home without substituting the local home', () => {
  const launch = resolveTmuxLaunch(
    { ...profile, type: 'ssh', host: 'user@server', shell: '$SHELL', cwd: '~/work' },
    environment,
    3,
    undefined,
    'catus-3',
  );
  expect(launch.program).toBe('ssh');
  expect(launch.args.slice(0, 3)).toEqual(['-tt', '--', 'user@server']);
  expect(launch.args[3]).toContain("'tmux' '-L' 'catus' '-CC'");
  expect(launch.args[3]).toContain("'=catus-3'");
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

test('SFTP can only be the default tab for an SSH host', () => {
  expect(
    parseConfig({
      version: 1,
      hosts: [{ ...profile, type: 'ssh', host: 'server', defaultTab: 'sftp' }],
      display: { language: 'en' },
    }).hosts[0]!.defaultTab,
  ).toBe('sftp');
  expect(() =>
    parseConfig({
      version: 1,
      hosts: [{ ...profile, type: 'local', defaultTab: 'sftp' }],
      display: { language: 'en' },
    }),
  ).toThrow('validation.sftpDefault');
});

test('launch preview follows the requested tab kind', () => {
  const ssh = { ...profile, type: 'ssh' as const, host: 'user@server' };
  expect(launchPreview(ssh, environment, 'shell')).toContain("'ssh' '-t' '--' 'user@server'");
  expect(launchPreview(ssh, environment, 'tmux')).toContain("'ssh' '-tt' '--' 'user@server'");
  expect(launchPreview(ssh, environment, 'tmux')).toContain('catus-0');
});
