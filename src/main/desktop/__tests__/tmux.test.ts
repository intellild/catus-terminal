import { expect, test } from '@rstest/core';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { killTmuxSession, listTmuxSessions, parseTmuxSessions } from '../tmux';

test('session listings parse numeric fields from the right so names keep separators', () => {
  expect(
    parseTmuxSessions('catus-0|2|1|1700000000\nname|with|pipes|1|0|1700000001\nbroken\n'),
  ).toEqual([
    { name: 'catus-0', windows: 2, attached: 1, activity: 1700000000 },
    { name: 'name|with|pipes', windows: 1, attached: 0, activity: 1700000001 },
  ]);
  expect(parseTmuxSessions('')).toEqual([]);
});

test('invalid destinations never reach a shell', async () => {
  await expect(listTmuxSessions('-oProxyCommand=bad')).rejects.toThrow();
});

test.skipIf(spawnSync('tmux', ['-V']).status !== 0)(
  'lists and kills sessions on the isolated catus server',
  async () => {
    const socket = `catus-api-test-${randomUUID()}`;
    const previous = process.env.CATUS_E2E_TMUX_SOCKET;
    process.env.CATUS_E2E_TMUX_SOCKET = socket;
    const run = (...args: string[]) =>
      spawnSync('tmux', ['-L', socket, ...args], { encoding: 'utf8' });
    try {
      expect(await listTmuxSessions()).toEqual([]);
      run('new-session', '-d', '-s', 'catus-0', '/bin/sh');
      run('new-session', '-d', '-s', 'catus-1', '/bin/sh');
      const sessions = await listTmuxSessions();
      expect(sessions.map((session) => session.name).sort()).toEqual(['catus-0', 'catus-1']);
      expect(sessions.every((session) => session.windows === 1)).toBe(true);

      await killTmuxSession(undefined, 'catus-0');
      expect((await listTmuxSessions()).map((session) => session.name)).toEqual(['catus-1']);
      await expect(killTmuxSession(undefined, '-oops')).rejects.toThrow(
        'Invalid tmux session name',
      );
    } finally {
      run('kill-server');
      if (previous === undefined) {
        delete process.env.CATUS_E2E_TMUX_SOCKET;
      } else {
        process.env.CATUS_E2E_TMUX_SOCKET = previous;
      }
    }
  },
);
