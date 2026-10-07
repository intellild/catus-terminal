import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

// Exercise the callback boundary wrapped as a JS Promise and the real OpenSSH protocol.
export async function verifySftp(connectSftpCallback) {
  const connectSftp = promisify(connectSftpCallback);
  const directory = await mkdtemp(path.join(tmpdir(), 'catus-sftp-'));
  const bin = path.join(directory, 'bin');
  const remote = path.join(directory, 'remote');
  await mkdir(bin);
  await mkdir(remote);
  const ssh = path.join(bin, 'ssh');
  await writeFile(
    ssh,
    '#!/bin/sh\nprintf "%s\\n" "$@" > "$CATUS_SFTP_ARGUMENTS"\nexec /usr/libexec/sftp-server -d "$CATUS_SFTP_DIRECTORY"\n',
  );
  await chmod(ssh, 0o755);
  const saved = {
    PATH: process.env.PATH,
    CATUS_SFTP_ARGUMENTS: process.env.CATUS_SFTP_ARGUMENTS,
    CATUS_SFTP_DIRECTORY: process.env.CATUS_SFTP_DIRECTORY,
  };
  process.env.PATH = `${bin}${path.delimiter}${process.env.PATH}`;
  process.env.CATUS_SFTP_DIRECTORY = remote;
  process.env.CATUS_SFTP_ARGUMENTS = path.join(directory, 'arguments');
  let connection;
  try {
    await assert.rejects(connectSftp({ destination: '-bad' }), /Invalid SSH destination/);
    const pending = connectSftp({ destination: 'test-alias', port: 2222 });
    assert.ok(pending instanceof Promise);
    const native = await pending;
    connection = Object.fromEntries(
      [
        'realpath',
        'stat',
        'readdir',
        'readDir',
        'metadata',
        'readFile',
        'writeFile',
        'createDir',
        'rename',
        'removeFile',
        'removeDir',
        'close',
      ].map((name) => [name, promisify(native[name].bind(native))]),
    );
    assert.deepEqual(
      (await readFile(process.env.CATUS_SFTP_ARGUMENTS, 'utf8')).trim().split('\n'),
      ['-T', '-o', 'BatchMode=yes', '-p', '2222', '-s', '--', 'test-alias', 'sftp'],
    );
    assert.equal(await connection.realpath('.'), await realpath(remote));
    await connection.createDir('目录');
    assert.equal((await connection.stat('目录')).fileType, 'directory');
    assert.deepEqual(
      (await connection.readdir('.')).map((entry) => entry.name),
      ['目录'],
    );
    const bytes = Uint8Array.from({ length: 256 * 1024 }, (_, i) => i % 256);
    const expected = bytes.slice();
    const written = connection.writeFile('目录/文件.bin', bytes);
    bytes.fill(0); // Native work must own a snapshot, not a mutable JS backing store.
    await written;
    assert.deepEqual(await connection.readFile('目录/文件.bin'), expected);
    const [entry] = await connection.readDir('目录');
    assert.equal(entry.name, '文件.bin');
    assert.equal(entry.path, '目录/文件.bin');
    assert.equal(entry.metadata.size, BigInt(expected.length));
    assert.equal(entry.metadata.fileType, 'file');
    assert.equal((await connection.metadata('目录')).fileType, 'directory');
    await connection.writeFile('目录/文件.bin', Uint8Array.of(42));
    assert.deepEqual(await connection.readFile('目录/文件.bin'), Uint8Array.of(42));
    await assert.rejects(connection.readFile('missing'), /Read remote file missing/);
    await connection.rename('目录/文件.bin', '目录/renamed');
    await connection.removeFile('目录/renamed');
    await connection.removeDir('目录');
    await Promise.all([connection.close(), connection.close()]);
    await assert.rejects(connection.readDir('.'), /closed/);
    console.log('N-API SFTP: Promises, SSH pipes, binary/Unicode files, metadata and close passed');
  } finally {
    await connection?.close();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    await rm(directory, { recursive: true, force: true });
  }
}
