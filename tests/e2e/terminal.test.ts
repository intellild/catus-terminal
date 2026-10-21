import { PNG } from 'pngjs';
import { setTimeout as delay } from 'node:timers/promises';
import { writeFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, test } from '@rstest/core';
import { LynxApp, waitFor } from '../support/lynx';
import { expectScreenshot } from '../support/screenshots';

let app: LynxApp;
const red = [205, 77, 77];
const blue = [108, 158, 225];
let nodeId: number;
let firstId: number;

beforeEach(async () => {
  app = new LynxApp();
  await app.start();
  await app.terminalFrame(red);
  const node = (await app.automation('terminal-surface').node())!;
  nodeId = node.nodeId;
  firstId = Number(app.attribute(node, 'terminal-id'));
  expect(firstId).toBe(1);
  expect(await app.sessionExists(firstId)).toBe(true);
});
afterEach(async () => {
  await app.close();
});

async function updateTerminal() {
  for (const key of [...'update', 'Enter']) {
    await app.automation('terminal-surface').invoke('key', {
      key,
      control: false,
      alt: false,
    });
  }
  await app.terminalFrame(blue);
}

test('starts the first host and presents the fake PTY through JS RAF', async () => {
  expect(firstId).toBeGreaterThan(0);
  expect(await app.automation('running-test').node()).toBeDefined();
  await expectScreenshot('initial-host', await app.screenshot());
});

test('native key input updates the PTY and automatically repaints ANSI and Unicode text', async () => {
  await updateTerminal();
  await expectScreenshot(
    'updated-terminal',
    await app.automation('terminal-viewport').screenshot(),
  );
});

test('new tabs get independent PTYs; switching back preserves contents and the native element', async () => {
  await updateTerminal();
  await app.automation('new-tab').tap();
  await waitFor('second session ID', async () => {
    const node = await app.automation('terminal-surface').node();
    return node && Number(app.attribute(node, 'terminal-id')) === 2 ? node : undefined;
  });
  await app.terminalFrame(red);
  expect((await app.automation('terminal-surface').node())!.nodeId).toBe(nodeId);
  await expectScreenshot('second-tab', await app.screenshot());
  await app.automation('tab-1').tap();
  await waitFor('first session rebound', async () => {
    const node = await app.automation('terminal-surface').node();
    return node && Number(app.attribute(node, 'terminal-id')) === firstId ? node : undefined;
  });
  await app.terminalFrame(blue);
  const node = (await app.automation('terminal-surface').node())!;
  expect(node.nodeId).toBe(nodeId);
  expect(Number(app.attribute(node, 'terminal-id'))).toBe(firstId);
  await expectScreenshot(
    'updated-terminal',
    await app.automation('terminal-viewport').screenshot(),
  );
});

test('host first activation creates a session and its dock indicator', async () => {
  await app.automation('host-other').tap();
  await waitFor('other host session bound', async () => {
    const node = await app.automation('terminal-surface').node();
    return node && Number(app.attribute(node, 'terminal-id')) === 2 ? node : undefined;
  });
  await waitFor('other host dock indicator', () => app.automation('running-other').node());
  await app.terminalFrame(red);
  expect(await app.automation('running-other').node()).toBeDefined();
  expect(await app.automation('tab-2').node()).toBeDefined();
  expect((await app.automation('terminal-surface').node())!.nodeId).toBe(nodeId);
  await expectScreenshot('other-host', await app.screenshot());
});

test('closing the last tab unbinds the persistent native view and removes the dock indicator', async () => {
  await app.automation('new-tab').tap();
  await waitFor('new tab', () => app.automation('tab-2').node());
  await app.automation('host-other').tap();
  await waitFor('other host tab', () => app.automation('tab-3').node());
  for (const id of [1, 2, 3]) {
    await waitFor(`session ${id} created in Rust registry`, async () =>
      (await app.sessionExists(id)) ? true : undefined,
    );
  }
  await app.automation('close-tab-3').tap();
  await waitFor('session 3 removed from Rust registry', async () =>
    !(await app.sessionExists(3)) ? true : undefined,
  );
  expect(await app.sessionExists(1)).toBe(true);
  expect(await app.sessionExists(2)).toBe(true);
  await app.automation('host-test').tap();
  await app.automation('close-tab-2').tap();
  await waitFor('session 2 removed from Rust registry', async () =>
    !(await app.sessionExists(2)) ? true : undefined,
  );
  expect(await app.sessionExists(1)).toBe(true);
  await app.automation('close-tab-1').tap();
  await waitFor('session 1 removed from Rust registry', async () =>
    !(await app.sessionExists(1)) ? true : undefined,
  );
  const node = await waitFor('session unbound', async () => {
    const node = await app.automation('terminal-surface').node();
    return node && app.attribute(node, 'terminal-id') === '0' ? node : undefined;
  });
  expect(node.nodeId).toBe(nodeId);
  expect(await app.automation('running-test').node()).toBeUndefined();
  expect(await app.automation('running-other').node()).toBeUndefined();
  expect(await app.automation('terminal-placeholder').node()).toBeDefined();
  await expectScreenshot('closed-tabs', await app.screenshot());
});

test('native scroll events synchronize the overlay and invoke positions history', async () => {
  await app.automation('terminal-surface').invoke('write', { text: 'history\r' });
  await waitFor('history output parsed', async () => {
    const text = await app.evaluate(
      `globalThis.multiApps[globalThis.currentDebugAppId || globalThis.currentAppId].NativeModules.nodejs.exposed.getTerminalSessionInfo(${firstId}).text`,
    );
    return typeof text === 'string' && text.includes('history 39') ? true : undefined;
  });
  const parsed = await app
    .automation('terminal-surface')
    .invoke<{ historyRows: number }>('getScrollState');
  const bar = await waitFor('scroll history event', async () => {
    const node = await app.automation('terminal-scrollbar').node();
    return node &&
      Number(app.attribute(node, 'data-history')) === parsed.historyRows &&
      parsed.historyRows > 0
      ? node
      : undefined;
  });
  const history = Number(app.attribute(bar, 'data-history'));
  await app.automation('terminal-surface').invoke('scrollTo', {
    sessionId: firstId,
    offset: history,
  });
  await waitFor('absolute scroll callback', async () => {
    const node = await app.automation('terminal-scrollbar').node();
    return node && Number(app.attribute(node, 'data-offset')) === history ? true : undefined;
  });
  const state = await app
    .automation('terminal-surface')
    .invoke<{ offset: number; historyRows: number }>('getScrollState');
  expect(state.offset).toBe(history);
  const overlay = await waitFor('visible overlay pixels above native texture', async () => {
    const buffer = await app.automation('terminal-viewport').screenshot();
    const image = PNG.sync.read(buffer);
    let pixels = 0;
    for (let y = 0; y < image.height; y++) {
      for (let x = image.width - 35; x < image.width; x++) {
        const p = (y * image.width + x) * 4;
        if (image.data[p] !== 17 || image.data[p + 1] !== 20 || image.data[p + 2] !== 25) {
          pixels++;
        }
      }
    }
    return pixels > 50 ? buffer : undefined;
  });
  await writeFile('.tmp/e2e/artifacts/terminal-scrollbar.actual.png', overlay);
  const point = await app.automation('terminal-scrollbar-thumb').visibleTarget();
  await app.cdp('Input.emulateTouchFromMouseEvent', {
    type: 'mousePressed',
    ...point,
    button: 'left',
    timestamp: Date.now() / 1000,
  });
  await delay(100);
  await app.cdp('Input.emulateTouchFromMouseEvent', {
    type: 'mouseMoved',
    x: point.x,
    y: point.y + 30,
    button: 'left',
    timestamp: Date.now() / 1000,
  });
  await delay(100);
  await app.cdp('Input.emulateTouchFromMouseEvent', {
    type: 'mouseReleased',
    x: point.x,
    y: point.y + 30,
    button: 'left',
    timestamp: Date.now() / 1000,
  });
  await waitFor('drag scroll callback', async () => {
    const node = await app.automation('terminal-scrollbar').node();
    return node && Number(app.attribute(node, 'data-offset')) < history ? true : undefined;
  });
  await app.automation('terminal-surface').invoke('scrollTo', {
    sessionId: firstId,
    offset: 0,
  });
  await waitFor('bottom scroll callback', async () => {
    const node = await app.automation('terminal-scrollbar').node();
    return node && Number(app.attribute(node, 'data-offset')) === 0 ? true : undefined;
  });
});
