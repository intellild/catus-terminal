import { afterEach, expect, test } from '@rstest/core';
import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { LynxApp, waitFor } from '../support/lynx';

let app: LynxApp;
afterEach(async () => {
  await app?.close();
});

test.skipIf(spawnSync('tmux', ['-V']).status !== 0)(
  'tmux terminals render pane output and manage tmux window tabs',
  async () => {
    app = new LynxApp();
    await app.start({ tmux: true });
    await app.terminalFrame([205, 77, 77]);
    const first = (await app.automation('terminal-surface').node())!;
    expect(app.attribute(first, 'terminal-id')).toBe('1');
    expect(app.tmuxWindows('catus-1')).toEqual(['tab-1']);
    await waitFor('first tmux window tab', () => app.automation('tmux-window-0').node());
    for (const key of [...'update', 'Enter']) {
      await app.automation('terminal-surface').invoke('key', {
        key,
        control: false,
        alt: false,
      });
    }
    await app.terminalFrame([108, 158, 225]);
    await writeFile(
      '.tmp/e2e/artifacts/tmux-updated.png',
      await app.automation('terminal-viewport').screenshot(),
    );

    await app.automation('tmux-new-window').tap();
    await waitFor('second tmux window tab', () => app.automation('tmux-window-1').node());
    await app.terminalFrame([205, 77, 77]);
    await writeFile(
      '.tmp/e2e/artifacts/tmux-window-tabs.png',
      await app.automation('application-layout').screenshot(),
    );
    expect(app.tmuxWindows('catus-1')).toHaveLength(2);
    await waitFor('new tmux window active', async () =>
      app.tmuxActiveWindow('catus-1') === 1 ? true : undefined,
    );
    await app.automation('tmux-window-0').tap();
    await waitFor('first tmux window active', async () =>
      app.tmuxActiveWindow('catus-1') === 0 ? true : undefined,
    );
    await app.terminalFrame([108, 158, 225]);
    await app.automation('close-tmux-window-1').tap();
    await waitFor('tmux window closed', async () =>
      app.tmuxWindows('catus-1').length === 1 ? true : undefined,
    );
    await waitFor('last tmux window hides its close action', async () =>
      (await app.automation('close-tmux-window-0').node()) ? undefined : true,
    );

    await app.automation('new-tab').tap();
    await waitFor('second tmux terminal', async () => {
      const node = await app.automation('terminal-surface').node();
      return node && app.attribute(node, 'terminal-id') === '2' ? node : undefined;
    });
    await app.terminalFrame([205, 77, 77]);
    expect(app.tmuxSessions()).toEqual(expect.arrayContaining(['catus-1', 'catus-2']));
    expect((await app.automation('terminal-surface').node())!.nodeId).toBe(first.nodeId);
    await app.automation('close-tab-2').tap();
    await waitFor('closed tmux terminal released', async () =>
      !(await app.sessionExists(2)) ? true : undefined,
    );
    expect(await app.sessionExists(1)).toBe(true);
    await waitFor('second tmux session closed', async () =>
      !app.tmuxSessions().includes('catus-2') ? true : undefined,
    );
    await app.terminalFrame([108, 158, 225]);
    await app.stopProcess();
    expect(app.tmuxWindows('catus-1')).toEqual(['tab-1']);
  },
);
