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
  await app.automation('add-workspace').tap();
  await waitFor('workspace Hook Form', () => app.automation('profile-name').node());
  await app.automation('workspace-type-ssh').tap();
  await waitFor('SSH host field', () => app.automation('profile-host').node());
  await app.automation('save-workspace').invoke('scrollIntoView', {
    scrollIntoViewOptions: { block: 'center', inline: 'center', behavior: 'none' },
  });
  await app.automation('save-workspace').tap();
  await waitFor('Schema validation error', () => app.automation('editor-error').node());
  expect(await app.automation('workspace-workspace-1').node()).toBeUndefined();
  await writeFile('.tmp/e2e/artifacts/workspace-schema-validation.png', await app.screenshot());
  await app.automation('workspace-type-local').invoke('scrollIntoView', {
    scrollIntoViewOptions: { block: 'center', inline: 'center', behavior: 'none' },
  });
  await app.automation('workspace-type-local').tap();
  await app.automation('save-workspace').invoke('scrollIntoView', {
    scrollIntoViewOptions: { block: 'center', inline: 'center', behavior: 'none' },
  });
  await app.automation('save-workspace').tap();
  await waitFor('saved local workspace', () => app.automation('workspace-workspace-1').node());
  expect(await app.automation('editor-error').node()).toBeUndefined();
});

test('Button hover changes pixels without activating and restores them on leave', async ({
  skip,
}) => {
  try {
    await app.automation('application-status').hover();
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
  const normal = await app.automation('add-workspace').screenshot();
  await app.automation('add-workspace').hover();
  const hovered = await waitFor('Button hover pixels', async () => {
    const image = await app.automation('add-workspace').screenshot();
    return comparePng(normal, image).changed > 100 ? image : undefined;
  });
  expect(await app.automation('profile-shell').node()).toBeUndefined();
  await expectScreenshot('button-add-workspace', normal);
  await expectScreenshot('button-add-workspace-hover', hovered);
  await app.automation('application-status').hover();
  await waitFor('Button mouseleave restores pixels', async () =>
    comparePng(normal, await app.automation('add-workspace').screenshot()).changed === 0
      ? true
      : undefined,
  );
  await app.automation('add-workspace').tap();
  await waitFor('Button still opens the form', () => app.automation('profile-shell').node());
});

test('English TOML translations render with correct plurals in Lynx', async () => {
  const summary = async () => {
    const node = await app.automation('session-summary').node();
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
  await app.automation('new-tab').tap();
  await expectSummary('1 workspace open · 2 tabs');
  await app.automation('close-tab-2').tap();
  await expectSummary('1 workspace open · 1 tab');
  await app.automation('close-tab-1').tap();
  await expectSummary('0 workspaces open · 0 tabs');
});

// TODO: re-enable after switching editor targets no longer times out on the SSH Host field.
test.skip('workspace modal switches local and SSH fields with a command preview', async () => {
  await app.automation('workspace-test').rightClick();
  await app.automation('workspace-menu-edit').tap();
  await waitFor('local shell select', () => app.automation('profile-shell').node());
  await expectScreenshot(
    'workspace-editor-local',
    await app.automation('workspace-editor-form').screenshot(),
  );
  await app.automation('close-settings').tap();
  await app.automation('workspace-other').rightClick();
  await app.automation('workspace-menu-edit').tap();
  await waitFor('SSH host input', () => app.automation('profile-host').node());
  expect(await app.automation('profile-shell').node()).toBeDefined();
  expect(await app.automation('ssh-command-preview').node()).toBeDefined();
  await expectScreenshot(
    'workspace-editor-ssh',
    await app.automation('workspace-editor-form').screenshot(),
  );
  await app.automation('workspace-type-local').tap();
  await waitFor('local shell select', () => app.automation('profile-shell').node());
  expect(await app.automation('profile-host').node()).toBeUndefined();
  await app.automation('close-settings').tap();
  await waitFor('closed modal', async () =>
    !(await app.automation('profile-shell').node()) ? true : undefined,
  );
});

test('SFTP browser uses native directory APIs and keeps terminal ownership separate', async () => {
  const surface = (await app.automation('terminal-surface').node())!;
  await app.automation('workspace-other').tap();
  await waitFor('SSH terminal', () => app.automation('tab-2').node());
  await app.automation('new-sftp-tab').tap();
  await waitFor('remote directory listing', () => app.automation('sftp-entry-0').node());
  expect(await app.automation('sftp-error').node()).toBeUndefined();
  expect(await app.sessionExists(2)).toBe(true);
  expect(await app.sessionExists(3)).toBe(false);
  expect((await app.automation('terminal-surface').node())!.nodeId).toBe(surface.nodeId);
  expect(await app.automation('sftp-breadcrumb-ellipsis').node()).toBeDefined();
  expect(await app.automation('sftp-breadcrumb-current').node()).toBeDefined();
  expect(await app.automation('sftp-entry-1').node()).toBeDefined(); // docs, readme.txt
  expect(await app.automation('sftp-entry-2').node()).toBeUndefined(); // .cache and .env are hidden
  expect(await app.automation('session-label').node()).toBeUndefined();
  expect(await app.automation('session-directory').node()).toBeUndefined();
  const visibleDirectory = await app.automation('sftp-list').screenshot();
  await app.automation('sftp-show-hidden').tap();
  await waitFor('hidden directory visible', () => app.automation('sftp-entry-3').node());
  await expectScreenshot(
    'sftp-toolbar-hidden-directories',
    await app.automation('sftp-toolbar').screenshot(),
  );
  await app.automation('sftp-show-hidden').tap();
  // Recycled cells may remain in the DOM; compare the rendered viewport.
  await waitFor('hidden files removed from the viewport', async () =>
    comparePng(visibleDirectory, await app.automation('sftp-list').screenshot()).changed === 0
      ? true
      : undefined,
  );
  await expectScreenshot('sftp-toolbar', await app.automation('sftp-toolbar').screenshot());
  await expectScreenshot('sftp-directory', await app.automation('sftp-list').screenshot());
  await app.automation('sftp-entry-0').tap(); // Directories sort before files.
  await waitFor('empty docs directory', () => app.automation('sftp-empty').node());
  await app.automation('tab-2').tap();
  await app.automation('tab-3').tap();
  expect(await app.automation('sftp-empty').node()).toBeDefined();
  await app.automation('sftp-up').tap();
  await waitFor('parent directory listing', () => app.automation('sftp-entry-1').node());
  await app.automation('sftp-refresh').tap();
  await waitFor('refreshed directory', () => app.automation('sftp-entry-1').node());
  await waitFor('upload button enabled after refresh', async () => {
    const button = await app.automation('sftp-upload').node();
    return button && !app.attribute(button, 'class')?.includes('opacity-50') ? true : undefined;
  });
  await app.automation('sftp-upload').tap();
  await waitFor('uploaded file appears after refresh', () =>
    app.node('[data-filename="uploaded.txt"]'),
  );
  await expectScreenshot('sftp-uploaded-directory', await app.automation('sftp-list').screenshot());
  await app.tap('[data-downloadfile="uploaded.txt"]');
  await waitFor('download saved to selected path', async () =>
    (await app.downloadedFile()) === 'Uploaded fixture' ? true : undefined,
  );
  expect(await app.automation('sftp-error').node()).toBeUndefined();
  await app.automation('close-tab-3').tap();
  await waitFor('SFTP browser released', async () =>
    !(await app.automation('sftp-browser').node()) ? true : undefined,
  );
  expect(await app.sessionExists(2)).toBe(true);
  await app.automation('new-sftp-tab').tap();
  await waitFor('reopened remote directory', () => app.automation('sftp-entry-1').node());
  expect(await app.automation('sftp-error').node()).toBeUndefined();
  await app.automation('close-tab-4').tap();
  await waitFor('reopened SFTP browser released', async () =>
    !(await app.automation('sftp-browser').node()) ? true : undefined,
  );
});

test('shell Select detects local and remote candidates and exposes custom command input', async () => {
  await app.automation('workspace-test').rightClick();
  await app.automation('workspace-menu-edit').tap();
  await waitFor('local shell select', () => app.automation('profile-shell').node());
  await app.automation('profile-shell').tap();
  await app.automation('profile-shell-option-1').visibleTarget();
  await app.automation('profile-shell-option-custom').invoke('scrollIntoView', {
    scrollIntoViewOptions: { block: 'center', inline: 'center', behavior: 'none' },
  });
  await app.automation('profile-shell-option-custom').tap();
  await waitFor('custom command input', () => app.automation('profile-command').node());
  await expectScreenshot(
    'shell-select-local',
    await app.automation('workspace-editor-form').screenshot(),
  );
  await app.automation('close-settings').tap();
  await app.automation('workspace-other').rightClick();
  await app.automation('workspace-menu-edit').tap();
  await waitFor('remote Host field', () => app.automation('profile-host').node());
  await app.automation('profile-shell').tap();
  // The SSH fixture reports zsh and bash. This waits for the real host process
  // result to cross the preload bridge and update the Effect atom.
  await waitFor('remote bash candidate', () => app.automation('profile-shell-option-2').node());
  await app.automation('profile-shell-option-2').tap();
  expect(await app.automation('profile-command').node()).toBeUndefined();
  await expectScreenshot(
    'shell-select-remote',
    await app.automation('workspace-editor-form').screenshot(),
  );
  await app.automation('profile-shell').tap();
  await app.automation('profile-shell-option-custom').tap();
  await waitFor('remote custom command input', () => app.automation('profile-command').node());
});

// TODO: re-enable after full-suite DevTool discovery remains available following runtime exits.
test.skip('dock plus creates a workspace; right-click edits and deletes only the target workspace', async () => {
  await app.automation('add-workspace').tap();
  await waitFor('new workspace form', () => app.automation('profile-shell').node());
  await writeFile(
    '.tmp/e2e/artifacts/workspace-add.actual.png',
    await app.automation('workspace-editor-form').screenshot(),
  );
  await app.automation('save-workspace').tap();
  await waitFor('new workspace in dock', () => app.automation('workspace-workspace-1').node());
  expect(await app.sessionExists(2)).toBe(false);
  await app.automation('workspace-other').rightClick();
  await app.automation('workspace-menu-edit').visibleTarget();
  await writeFile(
    '.tmp/e2e/artifacts/workspace-menu.actual.png',
    await app.automation('workspace-context-menu').screenshot(),
  );
  expect(await app.sessionExists(2)).toBe(false);
  await app.automation('workspace-menu-edit').tap();
  await waitFor('inactive SSH workspace editor', () => app.automation('profile-host').node());
  await app.automation('close-settings').tap();
  await app.automation('workspace-workspace-1').tap();
  await waitFor('new workspace terminal', () => app.automation('tab-2').node());
  expect(await app.sessionExists(2)).toBe(true);
  await app.automation('workspace-workspace-1').rightClick();
  await app.automation('workspace-menu-delete').tap();
  await waitFor('deleted workspace', async () =>
    !(await app.automation('workspace-workspace-1').node()) ? true : undefined,
  );
  expect(await app.sessionExists(2)).toBe(false);
  expect(await app.sessionExists(1)).toBe(true);
});

// TODO: re-enable after windowless Select hit-testing and composed screenshots work.
// Native mouse clicks work, but DevTool cannot reliably hit the mounted options.
test.skip('Popover anchors the Select, escapes the form scroll view and dismisses on outside taps', async () => {
  await app.automation('workspace-test').rightClick();
  await app.automation('workspace-menu-edit').tap();
  await app.automation('profile-shell').tap();
  await app.automation('profile-shell-option-1').visibleTarget();
  const trigger = (await app.automation('profile-shell').node())!;
  const content = (await app.automation('profile-shell-content').node())!;
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
  const contentScreenshot = await app.automation('profile-shell-content').screenshot();
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
    !(await app.automation('profile-shell-content').node()) ? true : undefined,
  );
  expect(await app.automation('profile-shell').node()).toBeDefined();
  await app.automation('close-settings').tap();
  await app.automation('workspace-other').rightClick();
  await app.automation('workspace-menu-edit').visibleTarget();
  await app.tap('.workspace-menu-dismiss');
  await waitFor('closed context menu', async () =>
    !(await app.automation('workspace-context-menu').node()) ? true : undefined,
  );
  expect(await app.sessionExists(2)).toBe(false);
});

// TODO: re-enable after full-suite DevTool discovery is stable; isolated execution currently passes.
test.skip('workspace menus dismiss outside and edit the workspace that owns the instance', async () => {
  for (const id of ['test', 'other', 'test']) {
    await app.automation(`workspace-${id}`).rightClick();
    await app.automation('workspace-menu-edit').visibleTarget();
    await writeFile(`.tmp/e2e/artifacts/workspace-menu-${id}.actual.png`, await app.screenshot());
    await app.tap('.workspace-menu-dismiss');
    await waitFor('dismissed workspace menu', async () =>
      !(await app.automation('workspace-context-menu').node()) ? true : undefined,
    );
  }
  for (const [id, name] of [
    ['test', 'Test'],
    ['other', 'Other'],
  ]) {
    await app.automation(`workspace-${id}`).rightClick();
    await app.automation('workspace-menu-edit').tap();
    expect(await app.automation('profile-name').invoke('getValue', {})).toBe(name);
    await app.automation('close-settings').tap();
    await waitFor('closed workspace menu', async () =>
      !(await app.automation('workspace-context-menu').node()) ? true : undefined,
    );
  }
});

// Capture each editor from a fresh app while the combined switching scenario is skipped.
test.each([
  ['test', 'workspace-editor-local', 'profile-shell'],
  ['other', 'workspace-editor-ssh', 'profile-host'],
])('workspace editor screenshot fixture (%s)', async (id, screenshot, field) => {
  await app.automation(`workspace-${id}`).rightClick();
  await app.automation('workspace-menu-edit').tap();
  await app.automation(field).visibleTarget();
  await expectScreenshot(screenshot, await app.automation('workspace-editor-form').screenshot());
});
