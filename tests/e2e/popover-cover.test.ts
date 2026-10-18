import { writeFile } from 'node:fs/promises';
import { expect, test } from '@rstest/core';
import { LynxApp, waitFor } from '../support/lynx';

test('covered menus and Select keep their layout and dismiss correctly in a native window', async () => {
  const app = new LynxApp();
  try {
    // Cover views use native overlay surfaces; exercise the real NSView host.
    await app.start({ windowless: false });
    await app.automation('workspace-test').rightClick();
    await app.automation('workspace-menu-edit').visibleTarget();
    await writeFile(
      '.tmp/e2e/artifacts/covered-menu.png',
      await app.automation('workspace-context-menu').screenshot(),
    );
    await app.tap('.workspace-menu-dismiss');
    await waitFor('dismissed covered menu', async () =>
      !(await app.automation('workspace-context-menu').node()) ? true : undefined,
    );

    await app.automation('add-workspace').tap();
    await app.automation('profile-shell').tap();
    await app.automation('profile-shell-option-1').visibleTarget();
    type Rect = { left: number; top: number; width: number; height: number };
    const trigger = await app.automation('profile-shell').invoke<Rect>('boundingClientRect');
    const content = await app
      .automation('profile-shell-content')
      .invoke<Rect>('boundingClientRect');
    expect(content.left).toBeCloseTo(trigger.left, 0);
    expect(content.top).toBeCloseTo(trigger.top + trigger.height + 4, 0);
    expect(content.width).toBeCloseTo(trigger.width, 0);
    await writeFile(
      '.tmp/e2e/artifacts/covered-select.png',
      await app.automation('profile-shell-content').screenshot(),
    );
    await app.tap('.profile-shell-dismiss');
    await waitFor('dismissed covered Select', async () =>
      !(await app.automation('profile-shell-content').node()) ? true : undefined,
    );

    await app.automation('profile-shell').tap();
    await app.automation('profile-shell-option-1').visibleTarget();
    await app.automation('profile-shell-option-custom').invoke('scrollIntoView', {
      scrollIntoViewOptions: { block: 'center', inline: 'center', behavior: 'none' },
    });
    await app.automation('profile-shell-option-custom').tap();
    await app.automation('profile-command').visibleTarget();
    expect(await app.automation('profile-shell-content').node()).toBeUndefined();
    expect(await app.sessionExists(1)).toBe(true);
  } finally {
    await app.close();
  }
});
