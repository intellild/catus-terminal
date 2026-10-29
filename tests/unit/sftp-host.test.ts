import { expect, rstest, test } from '@rstest/core';
import { createSftpHost } from '../../src/shared/sftp-host';
import type { NativeSftpHost } from '../../src/shared/sftp';

function fixture(): NativeSftpHost {
  return {
    sftpConnect: rstest.fn(async () => 7),
    sftpReaddir: rstest.fn(async () => [
      { name: 'docs', type: 'directory' },
      { name: 'readme.txt', type: 'file' },
    ]),
    sftpRealpath: rstest.fn(async () => '/home/test'),
    sftpStat: rstest.fn(async () => ({
      size: '9007199254740993',
      mtimeMs: 1234,
      type: 'directory',
    })),
    sftpClose: rstest.fn(async () => {}),
  };
}

test('preload SFTP operations preserve file predicates and bigint', async () => {
  const api = fixture();
  const host = createSftpHost(() => api);
  const remote = await host.connectSftp({ destination: 'test-host' });
  expect(api.sftpConnect).toHaveBeenCalledWith({ destination: 'test-host' });
  expect(await remote.readdir('.')).toEqual(['docs', 'readme.txt']);
  expect(api.sftpReaddir).toHaveBeenCalledWith(7, '.');
  const entries = await remote.readdir('.', { withFileTypes: true });
  expect(entries[0]!.isDirectory()).toBe(true);
  expect(entries[0]!.isFile()).toBe(false);
  expect(await remote.realpath('.')).toBe('/home/test');
  expect((await remote.stat('.')).size).toBe(9007199254740993n);
  expect((await remote.stat('.')).mtimeMs).toBe(1234);
  await remote.close();
  expect(api.sftpClose).toHaveBeenCalledWith(7);
});

test('N-API failures propagate to the background caller', async () => {
  const host = createSftpHost(() => ({
    ...fixture(),
    sftpConnect: async () => {
      throw new Error('SSH failed');
    },
  }));
  await expect(host.connectSftp({ destination: 'invalid' })).rejects.toThrow('SSH failed');
});
