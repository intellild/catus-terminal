import { expect, test } from '@rstest/core';
import { LynxApp, waitFor } from '../support/lynx';

test('embedded macOS terminal creates and renders a Metal drawable and keeps the session bound', async () => {
  const app = new LynxApp();
  try {
    await app.start({ windowless: false });
    const node = (await app.node('#terminal-surface'))!;
    const id = Number(app.attribute(node, 'terminal-id'));
    expect(await app.sessionExists(id)).toBe(true);
    expect(await app.invoke('#terminal-surface', 'renderFrame')).toBe(true);
    await app.invoke('#terminal-surface', 'write', { text: 'update\r' });
    await waitFor('embedded terminal PTY update', async () => {
      const text = await app.evaluate(
        `globalThis.multiApps[globalThis.currentDebugAppId || globalThis.currentAppId].NativeModules.nodejs.exposed.getTerminalSessionInfo(${id}).text`,
      );
      return typeof text === 'string' && text.includes('FAKE PTY UPDATED');
    });
    expect(await app.invoke('#terminal-surface', 'renderFrame')).toBe(true);
    expect((await app.node('#terminal-surface'))!.nodeId).toBe(node.nodeId);
    // Embedded AppKit subviews are outside Lynx's surface screenshot. Drawable
    // rendering is validated in Rust; screenshot comparisons use windowless OSR.
  } finally {
    await app.close();
  }
});
