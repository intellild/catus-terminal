import { afterEach, expect, test } from '@rstest/core';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createWorkspaceHost } from '../workspaceConfig';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
async function setup() {
  const directory = await mkdtemp(path.join(tmpdir(), 'catus-config-'));
  directories.push(directory);
  const file = path.join(directory, 'workspaces.json');
  return { file, host: createWorkspaceHost(file, { shell: '/bin/zsh', home: '/Users/test' }) };
}

test('first load writes built-in defaults; saves round-trip through a new host', async () => {
  const { file, host } = await setup();
  const initial = await host.loadWorkspaces();
  expect(initial.config.workspaces[0]!.command).toBe('$SHELL');
  expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(initial.config);
  const config = {
    ...initial.config,
    workspaces: [
      { ...initial.config.workspaces[0]!, name: 'Personal shell', command: '/bin/bash' },
    ],
  };
  await host.saveWorkspaces(config);
  const reopened = await createWorkspaceHost(file).loadWorkspaces();
  expect(reopened.config).toEqual(config);
});

test('malformed existing JSON is reported and remains unchanged', async () => {
  const { file, host } = await setup();
  await writeFile(file, '{broken-json');
  await expect(host.loadWorkspaces()).rejects.toThrow();
  expect(await readFile(file, 'utf8')).toBe('{broken-json');
});
