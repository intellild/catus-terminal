import { writeFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, test } from '@rstest/core';
import { PNG } from 'pngjs';
import { LynxApp, waitFor } from '../support/lynx';
import { comparePng, expectScreenshot } from '../support/screenshots';

let app: LynxApp;
beforeEach(async () => {
  app = new LynxApp();
  await app.start({ ssh: true });
});
afterEach(async () => {
  await app.close();
});

test('workspace modal switches local and SSH fields with a command preview', async () => {
  await app.rightClick('#workspace-test');
  await app.tap('#workspace-menu-edit');
  await waitFor('local shell select', () => app.node('#profile-shell'));
  await expectScreenshot('workspace-editor-local', await app.screenshot('#workspace-editor-form'));
  await app.tap('#close-settings');
  await app.rightClick('#workspace-other');
  await app.tap('#workspace-menu-edit');
  await waitFor('SSH host input', () => app.node('#profile-host'));
  expect(await app.node('#profile-shell')).toBeDefined();
  expect(await app.node('#ssh-command-preview')).toBeDefined();
  await expectScreenshot('workspace-editor-ssh', await app.screenshot('#workspace-editor-form'));
  await app.tap('#workspace-type-local');
  await waitFor('local shell select', () => app.node('#profile-shell'));
  expect(await app.node('#profile-host')).toBeUndefined();
  await app.tap('#close-settings');
  await waitFor('closed modal', async () =>
    !(await app.node('#profile-shell')) ? true : undefined,
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

test('shell Select detects local and remote candidates and exposes custom command input', async () => {
  await app.rightClick('#workspace-test');
  await app.tap('#workspace-menu-edit');
  await waitFor('local shell select', () => app.node('#profile-shell'));
  await app.tap('#profile-shell');
  await app.visibleTarget('#profile-shell-option-1');
  await app.invoke('#profile-shell-option-custom', 'scrollIntoView', {
    scrollIntoViewOptions: { block: 'center', inline: 'center', behavior: 'none' },
  });
  await app.tap('#profile-shell-option-custom');
  await waitFor('custom command input', () => app.node('#profile-command'));
  await writeFile(
    '.tmp/e2e/artifacts/shell-select-local.actual.png',
    await app.screenshot('#workspace-editor-form'),
  );
  await app.tap('#close-settings');
  await app.rightClick('#workspace-other');
  await app.tap('#workspace-menu-edit');
  await waitFor('remote Host field', () => app.node('#profile-host'));
  await app.tap('#profile-shell');
  // The SSH fixture reports zsh and bash. This waits for the real host process
  // result to cross the preload bridge and update the Effect atom.
  await waitFor('remote bash candidate', () => app.node('#profile-shell-option-2'));
  await app.tap('#profile-shell-option-2');
  expect(await app.node('#profile-command')).toBeUndefined();
  await writeFile(
    '.tmp/e2e/artifacts/shell-select-remote.actual.png',
    await app.screenshot('#workspace-editor-form'),
  );
  await app.tap('#profile-shell');
  await app.tap('#profile-shell-option-custom');
  await waitFor('remote custom command input', () => app.node('#profile-command'));
});

test('dock plus creates a workspace; right-click edits and deletes only the target workspace', async () => {
  await app.tap('#add-workspace');
  await waitFor('new workspace form', () => app.node('#profile-shell'));
  await writeFile(
    '.tmp/e2e/artifacts/workspace-add.actual.png',
    await app.screenshot('#workspace-editor-form'),
  );
  await app.tap('#save-workspace');
  await waitFor('new workspace in dock', () => app.node('#workspace-workspace-1'));
  expect(await app.sessionExists(2)).toBe(false);
  await app.rightClick('#workspace-other');
  await app.visibleTarget('#workspace-menu-edit');
  await writeFile(
    '.tmp/e2e/artifacts/workspace-menu.actual.png',
    await app.screenshot('#workspace-context-menu'),
  );
  expect(await app.sessionExists(2)).toBe(false);
  await app.tap('#workspace-menu-edit');
  await waitFor('inactive SSH workspace editor', () => app.node('#profile-host'));
  await app.tap('#close-settings');
  await app.tap('#workspace-workspace-1');
  await waitFor('new workspace terminal', () => app.node('#tab-2'));
  expect(await app.sessionExists(2)).toBe(true);
  await app.rightClick('#workspace-workspace-1');
  await app.tap('#workspace-menu-delete');
  await waitFor('deleted workspace', async () =>
    !(await app.node('#workspace-workspace-1')) ? true : undefined,
  );
  expect(await app.sessionExists(2)).toBe(false);
  expect(await app.sessionExists(1)).toBe(true);
});

test('Popover anchors the Select, escapes the form scroll view and dismisses on outside taps', async () => {
  await app.rightClick('#workspace-test');
  await app.tap('#workspace-menu-edit');
  await app.tap('#profile-shell');
  await app.visibleTarget('#profile-shell-option-1');
  const trigger = (await app.node('#profile-shell'))!;
  const content = (await app.node('#profile-shell-content'))!;
  const box = async (nodeId: number) =>
    (await app.cdp<{ model: { border: number[]; width: number } }>('DOM.getBoxModel', { nodeId }))
      .model;
  const [anchorBox, contentBox] = await Promise.all([box(trigger.nodeId), box(content.nodeId)]);
  expect(contentBox.border[0]).toBeCloseTo(anchorBox.border[0]!, 0);
  expect(contentBox.border[1]).toBeCloseTo(anchorBox.border[5]! + 4, 0);
  expect(contentBox.border[2]! - contentBox.border[0]!).toBeCloseTo(
    anchorBox.border[2]! - anchorBox.border[0]!,
    0,
  );
  const pageScreenshot = await app.screenshot();
  const contentScreenshot = await app.screenshot('#profile-shell-content');
  await writeFile('.tmp/e2e/artifacts/shell-popover.actual.png', pageScreenshot);
  await writeFile('.tmp/e2e/artifacts/shell-popover-content.actual.png', contentScreenshot);
  // A cropped node can render even when its portal is missing from the page.
  // Compare its interior with the composited page to catch that regression.
  const page = PNG.sync.read(pageScreenshot);
  const popup = PNG.sync.read(contentScreenshot);
  const scale = popup.width / (contentBox.border[2]! - contentBox.border[0]!);
  // Exclude the 8px rounded border: node screenshots have transparent corners,
  // while the page blends those pixels with the underlying form.
  const inset = Math.ceil(8 * scale) + 2;
  const interior = new PNG({
    width: popup.width - inset * 2,
    height: popup.height - inset * 2,
  });
  const composited = new PNG({ width: interior.width, height: interior.height });
  PNG.bitblt(popup, interior, inset, inset, interior.width, interior.height, 0, 0);
  PNG.bitblt(
    page,
    composited,
    Math.round(contentBox.border[0]! * scale) + inset,
    Math.round(contentBox.border[1]! * scale) + inset,
    interior.width,
    interior.height,
    0,
    0,
  );
  expect(comparePng(PNG.sync.write(interior), PNG.sync.write(composited)).changed).toBe(0);
  await app.tap('#profile-shell-dismiss');
  await waitFor('closed Select', async () =>
    !(await app.node('#profile-shell-content')) ? true : undefined,
  );
  expect(await app.node('#profile-shell')).toBeDefined();
  await app.tap('#close-settings');
  await app.rightClick('#workspace-other');
  await app.visibleTarget('#workspace-menu-edit');
  await app.tap('#workspace-menu-dismiss');
  await waitFor('closed context menu', async () =>
    !(await app.node('#workspace-context-menu')) ? true : undefined,
  );
  expect(await app.sessionExists(2)).toBe(false);
});
