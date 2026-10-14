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

test('workspace Schema validation blocks a blank SSH host and allows a local workspace', async () => {
  await app.tap('#add-workspace');
  await waitFor('workspace Hook Form', () => app.node('#profile-name'));
  await app.tap('#workspace-type-ssh');
  await waitFor('SSH host field', () => app.node('#profile-host'));
  await app.invoke('#save-workspace', 'scrollIntoView', {
    scrollIntoViewOptions: { block: 'center', inline: 'center', behavior: 'none' },
  });
  await app.tap('#save-workspace');
  await waitFor('Schema validation error', () => app.node('#editor-error'));
  expect(await app.node('#workspace-workspace-1')).toBeUndefined();
  await writeFile('.tmp/e2e/artifacts/workspace-schema-validation.png', await app.screenshot());
  await app.invoke('#workspace-type-local', 'scrollIntoView', {
    scrollIntoViewOptions: { block: 'center', inline: 'center', behavior: 'none' },
  });
  await app.tap('#workspace-type-local');
  await app.invoke('#save-workspace', 'scrollIntoView', {
    scrollIntoViewOptions: { block: 'center', inline: 'center', behavior: 'none' },
  });
  await app.tap('#save-workspace');
  await waitFor('saved local workspace', () => app.node('#workspace-workspace-1'));
  expect(await app.node('#editor-error')).toBeUndefined();
});

test('Button hover changes pixels without activating and restores them on leave', async ({
  skip,
}) => {
  try {
    await app.hover('#application-status');
  } catch (error) {
    // Lynxtron 0.0.28 has no native mouse CDP handler. Keep this check enabled
    // automatically when the runtime gains it; touch emulation cannot test hover.
    if (
      error instanceof Error &&
      error.message.includes('Not implemented: Input.dispatchMouseEvent')
    ) {
      console.warn('Skipping native hover screenshots: Input.dispatchMouseEvent is unavailable.');
      skip();
    }
    throw error;
  }
  const normal = await app.screenshot('#add-workspace');
  await app.hover('#add-workspace');
  const hovered = await waitFor('Button hover pixels', async () => {
    const image = await app.screenshot('#add-workspace');
    return comparePng(normal, image).changed > 100 ? image : undefined;
  });
  expect(await app.node('#profile-shell')).toBeUndefined();
  await expectScreenshot('button-add-workspace', normal);
  await expectScreenshot('button-add-workspace-hover', hovered);
  await app.hover('#application-status');
  await waitFor('Button mouseleave restores pixels', async () =>
    comparePng(normal, await app.screenshot('#add-workspace')).changed === 0 ? true : undefined,
  );
  await app.tap('#add-workspace');
  await waitFor('Button still opens the form', () => app.node('#profile-shell'));
});

test('English TOML translations render with correct plurals in Lynx', async () => {
  const summary = async () => {
    const node = await app.node('#session-summary');
    if (!node) {
      return undefined;
    }
    const { rawTextValues } = await app.cdp<{ rawTextValues: { text: string }[] }>(
      'DOM.innerText',
      { nodeId: node.nodeId },
    );
    return rawTextValues.map((value) => value.text).join('');
  };
  const expectSummary = (expected: string) =>
    waitFor(expected, async () => ((await summary()) === expected ? true : undefined));
  await expectSummary('1 workspace open · 1 tab');
  await app.tap('#new-tab');
  await expectSummary('1 workspace open · 2 tabs');
  await app.tap('#close-tab-2');
  await expectSummary('1 workspace open · 1 tab');
  await app.tap('#close-tab-1');
  await expectSummary('0 workspaces open · 0 tabs');
});

// TODO: re-enable after switching editor targets no longer times out on the SSH Host field.
test.skip('workspace modal switches local and SSH fields with a command preview', async () => {
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
  expect(await app.node('#sftp-breadcrumb-ellipsis')).toBeDefined();
  expect(await app.node('#sftp-breadcrumb-current')).toBeDefined();
  expect(await app.node('#sftp-entry-1')).toBeDefined(); // docs, readme.txt
  expect(await app.node('#sftp-entry-2')).toBeUndefined(); // .cache and .env are hidden
  expect(await app.node('#session-label')).toBeUndefined();
  expect(await app.node('#session-directory')).toBeUndefined();
  const visibleDirectory = await app.screenshot('#sftp-list');
  await app.tap('#sftp-show-hidden');
  await waitFor('hidden directory visible', () => app.node('#sftp-entry-3'));
  await expectScreenshot('sftp-toolbar-hidden-directories', await app.screenshot('#sftp-toolbar'));
  await app.tap('#sftp-show-hidden');
  // Recycled cells may remain in the DOM; compare the rendered viewport.
  await waitFor('hidden files removed from the viewport', async () =>
    comparePng(visibleDirectory, await app.screenshot('#sftp-list')).changed === 0
      ? true
      : undefined,
  );
  await expectScreenshot('sftp-toolbar', await app.screenshot('#sftp-toolbar'));
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
  await waitFor('upload button enabled after refresh', async () => {
    const button = await app.node('#sftp-upload');
    return button && !app.attribute(button, 'class')?.includes('opacity-50') ? true : undefined;
  });
  await app.tap('#sftp-upload');
  await waitFor('uploaded file appears after refresh', () =>
    app.node('[data-filename="uploaded.txt"]'),
  );
  await expectScreenshot('sftp-uploaded-directory', await app.screenshot('#sftp-list'));
  await app.tap('[data-downloadfile="uploaded.txt"]');
  await waitFor('download saved to selected path', async () =>
    (await app.downloadedFile()) === 'Uploaded fixture' ? true : undefined,
  );
  expect(await app.node('#sftp-error')).toBeUndefined();
  await app.tap('#close-tab-3');
  await waitFor('SFTP browser released', async () =>
    !(await app.node('#sftp-browser')) ? true : undefined,
  );
  expect(await app.sessionExists(2)).toBe(true);
  await app.tap('#new-sftp-tab');
  await waitFor('reopened remote directory', () => app.node('#sftp-entry-1'));
  expect(await app.node('#sftp-error')).toBeUndefined();
  await app.tap('#close-tab-4');
  await waitFor('reopened SFTP browser released', async () =>
    !(await app.node('#sftp-browser')) ? true : undefined,
  );
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
  await expectScreenshot('shell-select-local', await app.screenshot('#workspace-editor-form'));
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
  await expectScreenshot('shell-select-remote', await app.screenshot('#workspace-editor-form'));
  await app.tap('#profile-shell');
  await app.tap('#profile-shell-option-custom');
  await waitFor('remote custom command input', () => app.node('#profile-command'));
});

// TODO: re-enable after full-suite DevTool discovery remains available following runtime exits.
test.skip('dock plus creates a workspace; right-click edits and deletes only the target workspace', async () => {
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

// TODO: re-enable after windowless Select hit-testing and composed screenshots work.
// Native mouse clicks work, but DevTool cannot reliably hit the mounted options.
test.skip('Popover anchors the Select, escapes the form scroll view and dismisses on outside taps', async () => {
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
  // A cropped node can render even when it is clipped in the page.
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
  await app.tap('.profile-shell-dismiss');
  await waitFor('closed Select', async () =>
    !(await app.node('#profile-shell-content')) ? true : undefined,
  );
  expect(await app.node('#profile-shell')).toBeDefined();
  await app.tap('#close-settings');
  await app.rightClick('#workspace-other');
  await app.visibleTarget('#workspace-menu-edit');
  await app.tap('.workspace-menu-dismiss');
  await waitFor('closed context menu', async () =>
    !(await app.node('#workspace-context-menu')) ? true : undefined,
  );
  expect(await app.sessionExists(2)).toBe(false);
});

// TODO: re-enable after full-suite DevTool discovery is stable; isolated execution currently passes.
test.skip('workspace menus dismiss outside and edit the workspace that owns the instance', async () => {
  for (const id of ['test', 'other', 'test']) {
    await app.rightClick(`#workspace-${id}`);
    await app.visibleTarget('#workspace-menu-edit');
    await writeFile(`.tmp/e2e/artifacts/workspace-menu-${id}.actual.png`, await app.screenshot());
    await app.tap('.workspace-menu-dismiss');
    await waitFor('dismissed workspace menu', async () =>
      !(await app.node('#workspace-context-menu')) ? true : undefined,
    );
  }
  for (const [id, name] of [
    ['test', 'Test'],
    ['other', 'Other'],
  ]) {
    await app.rightClick(`#workspace-${id}`);
    await app.tap('#workspace-menu-edit');
    expect(await app.invoke('#profile-name', 'getValue', {})).toBe(name);
    await app.tap('#close-settings');
    await waitFor('closed workspace menu', async () =>
      !(await app.node('#workspace-context-menu')) ? true : undefined,
    );
  }
});

// Capture each editor from a fresh app while the combined switching scenario is skipped.
test.each([
  ['test', 'workspace-editor-local', '#profile-shell'],
  ['other', 'workspace-editor-ssh', '#profile-host'],
])('workspace editor screenshot fixture (%s)', async (id, screenshot, field) => {
  await app.rightClick(`#workspace-${id}`);
  await app.tap('#workspace-menu-edit');
  await app.visibleTarget(field);
  await expectScreenshot(screenshot, await app.screenshot('#workspace-editor-form'));
});
