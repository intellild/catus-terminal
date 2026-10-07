import { expect, rstest, test } from '@rstest/core';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { createFileUploader } from '../../src/main/desktop/uploadFiles';
import { SftpClient } from '../../src/app/api/SftpClient';
import { createSftpService } from '../../src/main/desktop/sftpService';

const execFileAsync = promisify(execFile);

test('upload cancellation does not launch scp; upload failures cross the bridge', async () => {
  const scp = rstest.fn(async () => ({ stdout: '', stderr: '' }));
  const upload = createFileUploader(async () => ({ canceled: true, filePaths: [] }), scp);
  expect(await upload('test-host', '/remote')).toBe(false);
  expect(scp).not.toHaveBeenCalled();
  const service = createSftpService(
    async () => {
      throw new Error('unused');
    },
    async () => {
      throw new Error('scp failed');
    },
  );
  const client = new SftpClient((request) => service.handle(request));
  await expect(client.uploadFiles('test-host', '/remote')).rejects.toThrow('scp failed');
});

test('scp uploads multiple files with literal names to the current directory', async () => {
  if (process.platform !== 'darwin') {
    return;
  }
  const temporary = await mkdtemp(path.join(tmpdir(), 'catus-upload-'));
  try {
    const directory = path.join(temporary, 'remote with spaces; literal');
    await mkdir(directory);
    const files = [path.join(temporary, 'hello world.txt'), path.join(temporary, "-quote'$.txt")];
    await Promise.all(files.map((file, index) => writeFile(file, `content ${index}`)));
    const run = rstest.fn((args: string[]) =>
      // Exercise the real scp SFTP transfer against a local SFTP server.
      execFileAsync('/usr/bin/scp', ['-D', '/usr/libexec/sftp-server', ...args]),
    );
    const upload = createFileUploader(async () => ({ canceled: false, filePaths: files }), run);
    const service = createSftpService(async () => {
      throw new Error('unused');
    }, upload);
    const client = new SftpClient((request) => service.handle(request));
    expect(await client.uploadFiles('test-host', directory)).toBe(true);
    expect(run).toHaveBeenCalledWith([
      '-o',
      'BatchMode=yes',
      '--',
      ...files,
      `test-host:${directory}/`,
    ]);
    for (let index = 0; index < files.length; index++) {
      expect(await readFile(path.join(directory, path.basename(files[index]!)), 'utf8')).toBe(
        `content ${index}`,
      );
    }
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
