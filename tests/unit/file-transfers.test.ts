import { expect, rstest, test } from '@rstest/core';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { createFileUploader, createFileDownloader } from '../../src/main/desktop/file-transfers';
import { SftpClient } from '../../src/app/api/sftp-client';
import { createSftpService } from '../../src/main/desktop/sftp-service';

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

test('download cancellation does not launch scp and errors cross the bridge', async () => {
  const run = rstest.fn(async () => {});
  const select = rstest.fn(async () => ({ canceled: true }));
  const download = createFileDownloader(select, run);
  expect(await download('test-host', '/remote/file.txt')).toBe(false);
  expect(select).toHaveBeenCalledWith('file.txt');
  expect(run).not.toHaveBeenCalled();
  const service = createSftpService(
    async () => {
      throw new Error('unused');
    },
    undefined,
    async () => {
      throw new Error('download failed');
    },
  );
  const client = new SftpClient((request) => service.handle(request));
  await expect(client.downloadFile('test-host', '/remote/file.txt')).rejects.toThrow(
    'download failed',
  );
});

test('scp downloads exactly one literal filename into the chosen save path', async () => {
  if (process.platform !== 'darwin') {
    return;
  }
  const temporary = await mkdtemp(path.join(tmpdir(), 'catus-download-'));
  try {
    const filename = "file [1]*? ' $.txt";
    const remotePath = path.join(temporary, filename);
    const target = path.join(temporary, 'saved file.txt');
    await writeFile(remotePath, 'Downloaded content');
    await writeFile(path.join(temporary, "file 1otherX ' $.txt"), 'Wrong glob match');
    const select = rstest.fn(async () => ({ canceled: false, filePath: target }));
    const download = createFileDownloader(select, (args) =>
      execFileAsync('/usr/bin/scp', ['-D', '/usr/libexec/sftp-server', ...args]),
    );
    const service = createSftpService(
      async () => {
        throw new Error('unused');
      },
      undefined,
      download,
    );
    const client = new SftpClient((request) => service.handle(request));
    expect(await client.downloadFile('test-host', remotePath)).toBe(true);
    expect(select).toHaveBeenCalledWith(filename);
    expect(await readFile(target, 'utf8')).toBe('Downloaded content');
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
