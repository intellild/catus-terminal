import { afterEach, beforeEach, expect, test } from '@rstest/core';
import { LynxApp, waitFor } from '../support/lynx';
import { expectScreenshot } from '../support/screenshots';

let app: LynxApp;
beforeEach(async () => {
  app = new LynxApp();
  await app.start({ ssh: true });
});
afterEach(async () => {
  await app.close();
});

test('workspace modal switches local and SSH fields with a command preview', async () => {
  await app.tap('#edit-workspace');
  await waitFor('local command input', () => app.node('#profile-command'));
  await expectScreenshot('workspace-editor-local', await app.screenshot('#workspace-editor-form'));
  await app.tap('#edit-profile-other');
  await waitFor('SSH host input', () => app.node('#profile-host'));
  expect(await app.node('#profile-command')).toBeUndefined();
  expect(await app.node('#ssh-command-preview')).toBeDefined();
  await expectScreenshot('workspace-editor-ssh', await app.screenshot('#workspace-editor-form'));
  await app.tap('#workspace-type-local');
  await waitFor('local command tab', () => app.node('#profile-command'));
  expect(await app.node('#profile-host')).toBeUndefined();
  await app.tap('#close-settings');
  await waitFor('closed modal', async () =>
    !(await app.node('#profile-command')) ? true : undefined,
  );
});

test('SFTP browser uses native directory APIs and keeps terminal ownership separate', async () => {
  const surface = (await app.node('#terminal-surface'))!;
  await app.tap('#workspace-other');
  await waitFor('SSH terminal', () => app.node('#tab-2'));
  await app.tap('#new-sftp-tab');
  await waitFor('remote directory listing', () => app.node('#sftp-entry-0'));
  expect(await app.node('#sftp-error')).toBeUndefined();
  expect(await app.sessionExists(2)).toBe(true);
  expect(await app.sessionExists(3)).toBe(false);
  expect((await app.node('#terminal-surface'))!.nodeId).toBe(surface.nodeId);
  await expectScreenshot('sftp-directory', await app.screenshot('#sftp-list'));
  await app.tap('#sftp-entry-0'); // Directories sort before files.
  await waitFor('empty docs directory', () => app.node('#sftp-empty'));
  await app.tap('#tab-2');
  await app.tap('#tab-3');
  expect(await app.node('#sftp-empty')).toBeDefined();
  await app.tap('#sftp-up');
  await waitFor('parent directory listing', () => app.node('#sftp-entry-1'));
  await app.tap('#sftp-refresh');
  await waitFor('refreshed directory', () => app.node('#sftp-entry-1'));
  await app.tap('#close-tab-3');
  await waitFor('SFTP browser released', async () =>
    !(await app.node('#sftp-browser')) ? true : undefined,
  );
  expect(await app.sessionExists(2)).toBe(true);
});
