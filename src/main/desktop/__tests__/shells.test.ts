import { expect, test, rstest } from '@rstest/core';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { listShells, shellPaths } from '../shells';

const { execute } = rstest.hoisted(() => ({
  execute: rstest.fn(async () => ({
    stdout: '/bin/zsh\n# allowed\n/bin/bash\n/bin/zsh\n',
    stderr: '',
  })),
}));
rstest.mock('node:child_process', () => {
  const execFile = () => {};
  Object.defineProperty(execFile, Symbol.for('nodejs.util.promisify.custom'), { value: execute });
  return { execFile };
});

test('shell detection parses comments, rejects malformed paths and checks local executables', async () => {
  expect(
    shellPaths('# header\n/bin/zsh\n/bin/bash # comment\n/bin/zsh\r\nrelative\n/bad path\n'),
  ).toEqual(['/bin/zsh', '/bin/bash']);
  const shells = await listShells();
  expect(shells.length).toBeGreaterThan(0);
  for (const shell of shells) {
    await access(shell.value, constants.X_OK);
    expect(shell.label).toContain(shell.value);
  }
});
test('remote detection passes Host as argv and bounds the noninteractive SSH probe', async () => {
  const shells = await listShells('user@alias');
  expect(shells.map((shell) => shell.value)).toEqual(['/bin/zsh', '/bin/bash']);
  expect(execute).toHaveBeenCalledWith(
    'ssh',
    [
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=5',
      '--',
      'user@alias',
      expect.stringContaining('/etc/shells'),
    ],
    expect.objectContaining({ timeout: 8000 }),
  );
  const calls = execute.mock.calls.length;
  await expect(listShells('-oProxyCommand=bad')).rejects.toThrow();
  expect(execute).toHaveBeenCalledTimes(calls);
});
