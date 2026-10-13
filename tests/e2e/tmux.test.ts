import { afterEach, expect, test } from '@rstest/core';
import { writeFile } from 'node:fs/promises';
import { LynxApp, waitFor } from '../support/lynx';

let app: LynxApp;
afterEach(async () => {
  await app?.close();
});

test('tmux workspace renders decoded pane output, forwards native input and keeps tabs independent', async () => {
  app = new LynxApp();
  await app.start({ tmux: true });
  await app.terminalFrame([205, 77, 77]);
  const first = (await app.node('#terminal-surface'))!;
  expect(app.attribute(first, 'terminal-id')).toBe('1');
  for (const key of [...'update', 'Enter']) {
    await app.invoke('#terminal-surface', 'key', { key, control: false, alt: false });
  }
  await app.terminalFrame([108, 158, 225]);
  await writeFile(
    '.tmp/e2e/artifacts/tmux-updated.png',
    await app.screenshot('#terminal-viewport'),
  );
  await app.tap('#new-tab');
  await waitFor('second tmux tab', async () => {
    const node = await app.node('#terminal-surface');
    return node && app.attribute(node, 'terminal-id') === '2' ? node : undefined;
  });
  await app.terminalFrame([205, 77, 77]);
  expect((await app.node('#terminal-surface'))!.nodeId).toBe(first.nodeId);
  await app.tap('#tab-1');
  await app.terminalFrame([108, 158, 225]);
  await app.tap('#close-tab-2');
  await waitFor('closed tmux tab released', async () =>
    !(await app.sessionExists(2)) ? true : undefined,
  );
  expect(await app.sessionExists(1)).toBe(true);
  await waitFor('only first tmux window remains', async () =>
    app.tmuxWindows().length === 1 ? true : undefined,
  );
  await app.stopProcess();
  expect(app.tmuxWindows()).toEqual(['tab-1']);
});
