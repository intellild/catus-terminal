import { expect, rstest, test } from '@rstest/core';
import { SftpClient } from '../../src/app/api/sftp-client';
import { createSftpService } from '../../src/main/desktop/sftp-service';
import type { RemoteFs } from '../../src/shared/sftp';

function fixture(): RemoteFs {
  const predicates = {
    isDirectory: () => true,
    isFile: () => false,
    isSymbolicLink: () => false,
  };
  return {
    readdir: rstest.fn(async () => [
      { name: 'docs', ...predicates },
    ]) as unknown as RemoteFs['readdir'],
    realpath: rstest.fn(async () => '/home/test'),
    stat: rstest.fn(async () => ({ size: 9007199254740993n, mtimeMs: 1234, ...predicates })),
    close: rstest.fn(async () => {}),
  };
}

test('SFTP bridge round trip preserves file predicates and bigint through JSON', async () => {
  const fs = fixture();
  const connect = rstest.fn(async () => fs);
  const service = createSftpService(connect);
  const host = new SftpClient(async (request) =>
    JSON.parse(JSON.stringify(await service.handle(JSON.parse(JSON.stringify(request))))),
  );
  const remote = await host.connectSftp({ destination: 'test-host' });
  expect(connect).toHaveBeenCalledWith({ destination: 'test-host' });
  expect(await remote.readdir('.')).toEqual(['docs']);
  const entries = await remote.readdir('.', { withFileTypes: true });
  expect(entries[0]!.isDirectory()).toBe(true);
  expect(entries[0]!.isFile()).toBe(false);
  expect(await remote.realpath('.')).toBe('/home/test');
  expect((await remote.stat('.')).size).toBe(9007199254740993n);
  await remote.close();
  await remote.close();
  expect(fs.close).toHaveBeenCalledTimes(1);
  await expect(remote.readdir('.')).rejects.toThrow('SFTP connection is closed');
  await service.dispose();
});

test('SFTP failures are replies rather than unhandled bridge rejections', async () => {
  const service = createSftpService(async () => {
    throw new Error('SSH failed');
  });
  const host = new SftpClient((request) => service.handle(request));
  await expect(host.connectSftp({ destination: 'invalid' })).rejects.toThrow('SSH failed');
});

test('SFTP service disposes both existing and late connections', async () => {
  const first = fixture();
  const late = fixture();
  let resolve!: (fs: RemoteFs) => void;
  const pending = new Promise<RemoteFs>((done) => {
    resolve = done;
  });
  const service = createSftpService(async ({ destination }) =>
    destination === 'late' ? pending : first,
  );
  await service.handle({ operation: 'connect', destination: 'first' });
  const connection = service.handle({ operation: 'connect', destination: 'late' });
  await service.dispose();
  resolve(late);
  expect(await connection).toEqual({ ok: false, error: 'SFTP service is closed' });
  expect(first.close).toHaveBeenCalledTimes(1);
  expect(late.close).toHaveBeenCalledTimes(1);
});
