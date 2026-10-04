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
  const node = (await app.node('#terminal-surface'))!;
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
    await app.invoke('#terminal-surface', 'key', { key, control: false, alt: false });
  }
  await app.terminalFrame(blue);
}

test('starts the first workspace and presents the fake PTY through JS RAF', async () => {
  expect(firstId).toBeGreaterThan(0);
  expect(await app.node('#running-test')).toBeDefined();
  await expectScreenshot('initial-workspace', await app.screenshot());
});

test('native key input updates the PTY and automatically repaints ANSI and Unicode text', async () => {
  await updateTerminal();
  await expectScreenshot('updated-terminal', await app.screenshot('#terminal-viewport'));
});

test('new tabs get independent PTYs; switching back preserves contents and the native element', async () => {
  await updateTerminal();
  await app.tap('#new-tab');
  await waitFor('second session ID', async () => {
    const node = await app.node('#terminal-surface');
    return node && Number(app.attribute(node, 'terminal-id')) === 2 ? node : undefined;
  });
  await app.terminalFrame(red);
  expect((await app.node('#terminal-surface'))!.nodeId).toBe(nodeId);
  await expectScreenshot('second-tab', await app.screenshot());
  await app.tap('#tab-1');
  await waitFor('first session rebound', async () => {
    const node = await app.node('#terminal-surface');
    return node && Number(app.attribute(node, 'terminal-id')) === firstId ? node : undefined;
  });
  await app.terminalFrame(blue);
  const node = (await app.node('#terminal-surface'))!;
  expect(node.nodeId).toBe(nodeId);
  expect(Number(app.attribute(node, 'terminal-id'))).toBe(firstId);
  await expectScreenshot('updated-terminal', await app.screenshot('#terminal-viewport'));
});

test('workspace first activation creates a session and its dock indicator', async () => {
  await app.tap('#workspace-other');
  await waitFor('other workspace session bound', async () => {
    const node = await app.node('#terminal-surface');
    return node && Number(app.attribute(node, 'terminal-id')) === 2 ? node : undefined;
  });
  await waitFor('other workspace dock indicator', () => app.node('#running-other'));
  await app.terminalFrame(red);
  expect(await app.node('#running-other')).toBeDefined();
  expect(await app.node('#tab-2')).toBeDefined();
  expect((await app.node('#terminal-surface'))!.nodeId).toBe(nodeId);
  await expectScreenshot('other-workspace', await app.screenshot());
});

test('closing the last tab unbinds the persistent native view and removes the dock indicator', async () => {
  await app.tap('#new-tab');
  await waitFor('new tab', () => app.node('#tab-2'));
  await app.tap('#workspace-other');
  await waitFor('other workspace tab', () => app.node('#tab-3'));
  for (const id of [1, 2, 3]) {
    await waitFor(`session ${id} created in Rust registry`, async () =>
      (await app.sessionExists(id)) ? true : undefined,
    );
  }
  await app.tap('#close-tab-3');
  await waitFor('session 3 removed from Rust registry', async () =>
    !(await app.sessionExists(3)) ? true : undefined,
  );
  expect(await app.sessionExists(1)).toBe(true);
  expect(await app.sessionExists(2)).toBe(true);
  await app.tap('#workspace-test');
  await app.tap('#close-tab-2');
  await waitFor('session 2 removed from Rust registry', async () =>
    !(await app.sessionExists(2)) ? true : undefined,
  );
  expect(await app.sessionExists(1)).toBe(true);
  await app.tap('#close-tab-1');
  await waitFor('session 1 removed from Rust registry', async () =>
    !(await app.sessionExists(1)) ? true : undefined,
  );
  const node = await waitFor('session unbound', async () => {
    const node = await app.node('#terminal-surface');
    return node && app.attribute(node, 'terminal-id') === '0' ? node : undefined;
  });
  expect(node.nodeId).toBe(nodeId);
  expect(await app.node('#running-test')).toBeUndefined();
  expect(await app.node('#running-other')).toBeUndefined();
  expect(await app.node('#terminal-placeholder')).toBeDefined();
  await expectScreenshot('closed-tabs', await app.screenshot());
});
