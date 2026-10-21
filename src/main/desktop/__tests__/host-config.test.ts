import { afterEach, expect, test } from '@rstest/core';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHostService } from '../host-config';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
async function setup() {
  const directory = await mkdtemp(path.join(tmpdir(), 'catus-config-'));
  directories.push(directory);
  const file = path.join(directory, 'hosts.json');
  return { file, host: createHostService(file, { shell: '/bin/zsh', home: '/Users/test' }) };
}

test('first load writes built-in defaults; saves round-trip through a new host', async () => {
  const { file, host } = await setup();
  const initial = await host.loadHosts();
  expect(initial.config.hosts[0]!.command).toBe('$SHELL');
  expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(initial.config);
  const config = {
    ...initial.config,
    hosts: [
      {
        ...initial.config.hosts[0]!,
        name: 'Personal shell',
        command: '/bin/bash',
        defaultTab: 'tmux' as const,
      },
    ],
  };
  await host.saveHosts(config);
  const reopened = await createHostService(file).loadHosts();
  expect(reopened.config).toEqual(config);
});

test('malformed existing JSON is backed up beside the config and replaced with defaults', async () => {
  const { file, host } = await setup();
  await writeFile(file, '{broken-json');
  const payload = await host.loadHosts();
  expect(payload.config.hosts[0]!.command).toBe('$SHELL');
  expect(await readFile(`${file}.bak`, 'utf8')).toBe('{broken-json');
  expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(payload.config);
});

test('schema-invalid configs use unique backup names and restart from defaults', async () => {
  const { file, host } = await setup();
  await writeFile(file, JSON.stringify({ version: 1, hosts: [] }));
  await host.loadHosts();
  expect(await readFile(`${file}.bak`, 'utf8')).toBe(JSON.stringify({ version: 1, hosts: [] }));

  await writeFile(file, JSON.stringify({ version: 2, hosts: [] }));
  const payload = await host.loadHosts();
  expect(await readFile(`${file}.1.bak`, 'utf8')).toBe(JSON.stringify({ version: 2, hosts: [] }));
  expect(payload.config.hosts).toHaveLength(1);
  expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(payload.config);
});
