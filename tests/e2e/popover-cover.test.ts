import { writeFile } from 'node:fs/promises';
import { expect, test } from '@rstest/core';
import { LynxApp, waitFor } from '../support/lynx';

test('covered dialogs and Select keep their layout and dismiss correctly in a native window', async () => {
  const app = new LynxApp();
  try {
    // Cover views use native overlay surfaces; exercise the real NSView host.
    await app.start({ windowless: false });
    await app.automation('open-settings').tap();
    await app.automation('settings-dialog').visibleTarget();
    await app.automation('add-workspace').tap();
    interface InspectorNode {
      nodeId: number;
      nodeName: string;
      attributes?: string[];
      children?: InspectorNode[];
    }
    const { root } = await app.cdp<{ root: InspectorNode }>('DOM.getDocument', { depth: -1 });
    const covered = (node: InspectorNode, id: string, insideCover = false): boolean => {
      const inside = insideCover || node.nodeName.toLowerCase() === 'cover-view';
      if (app.attribute(node, 'data-automation-id') === id) {
        return inside;
      }
      return node.children?.some((child) => covered(child, id, inside)) ?? false;
    };
    expect(covered(root, 'settings-dialog')).toBe(true);
    expect(covered(root, 'settings-overlay')).toBe(true);
    await writeFile(
      '.tmp/e2e/artifacts/covered-dialog.png',
      await app.automation('settings-dialog').screenshot(),
    );
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
    // This target is behind the modal. Its coordinates should hit the backdrop,
    // dismiss the dialog and never activate the underlying new-tab action.
    const behind = (await app.automation('new-tab').node())!;
    const { model } = await app.cdp<{ model: { content: number[] } }>('DOM.getBoxModel', {
      nodeId: behind.nodeId,
    });
    const x = (model.content[0]! + model.content[4]!) / 2;
    const y = (model.content[1]! + model.content[5]!) / 2;
    const hit = await app.cdp<{ nodeId: number }>('DOM.getNodeForLocation', { x, y });
    expect(hit.nodeId).toBe((await app.automation('settings-overlay').node())!.nodeId);
    for (const type of ['mousePressed', 'mouseReleased']) {
      await app.cdp('Input.emulateTouchFromMouseEvent', {
        type,
        x,
        y,
        button: 'left',
        timestamp: Date.now() / 1000,
        clickCount: 1,
      });
    }
    await waitFor('dismissed covered dialog', async () =>
      !(await app.automation('settings-dialog').node()) ? true : undefined,
    );
    expect(await app.sessionExists(2)).toBe(false);
    expect(await app.sessionExists(1)).toBe(true);
  } finally {
    await app.close();
  }
});
