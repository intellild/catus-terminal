import { afterEach, expect, test } from '@rstest/core';
import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { LynxApp, waitFor } from '../support/lynx';

let app: LynxApp;
afterEach(async () => {
  await app?.close();
});

test.skipIf(spawnSync('tmux', ['-V']).status !== 0)(
  'tmux terminals render pane output, manage windows and reuse the machine session',
  async () => {
    app = new LynxApp();
    await app.start({ tmux: true });
    await app.terminalFrame([205, 77, 77]);
    const first = (await app.automation('terminal-surface').node())!;
    expect(app.attribute(first, 'terminal-id')).toBe('1');
    // A machine without sessions creates the prefixed session.
    expect(app.tmuxWindows('catus-0')).toEqual(['tab-1']);
    expect(app.tmuxSessions()).toEqual(['catus-0']);
    await waitFor('session count badge', () => app.automation('tmux-session-count').node());
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
    expect(app.tmuxWindows('catus-0')).toHaveLength(2);
    await waitFor('new tmux window active', async () =>
      app.tmuxActiveWindow('catus-0') === 1 ? true : undefined,
    );
    await app.automation('tmux-window-0').tap();
    await waitFor('first tmux window active', async () =>
      app.tmuxActiveWindow('catus-0') === 0 ? true : undefined,
    );
    await app.terminalFrame([108, 158, 225]);
    await app.automation('close-tmux-window-1').tap();
    await waitFor('tmux window closed', async () =>
      app.tmuxWindows('catus-0').length === 1 ? true : undefined,
    );
    await waitFor('last tmux window hides its close action', async () =>
      (await app.automation('close-tmux-window-0').node()) ? undefined : true,
    );

    // A second tab attaches the machine session instead of creating another one.
    await app.automation('new-tab').tap();
    await waitFor('second tmux terminal', async () => {
      const node = await app.automation('terminal-surface').node();
      return node && app.attribute(node, 'terminal-id') === '2' ? node : undefined;
    });
    // The attached session keeps the blue frame produced by the typed update.
    await app.terminalFrame([108, 158, 225]);
    expect(app.tmuxSessions()).toEqual(['catus-0']);
    expect((await app.automation('terminal-surface').node())!.nodeId).toBe(first.nodeId);
    await app.automation('close-tab-2').tap();
    await waitFor('closed tmux terminal released', async () =>
      !(await app.sessionExists(2)) ? true : undefined,
    );
    expect(await app.sessionExists(1)).toBe(true);
    // Closing a tab only detaches; the tmux session keeps running.
    expect(app.tmuxSessions()).toEqual(['catus-0']);
    await app.terminalFrame([108, 158, 225]);
    await app.stopProcess();
    expect(app.tmuxWindows('catus-0')).toEqual(['tab-1']);
  },
);

// Windowless input emulation cannot dispatch native mouse events, so the context
// menu and hover actions run against a real window. Pixels are covered by the
// windowless test; this one asserts the session lifecycle behind the menu.
test.skipIf(spawnSync('tmux', ['-V']).status !== 0)(
  'the tmux badge menu attaches, starts and closes sessions',
  async () => {
    app = new LynxApp();
    await app.start({ tmux: true, windowless: false });
    await waitFor('first terminal', () => app.automation('terminal-surface').node());
    await waitFor('tmux session', async () =>
      app.tmuxSessions().includes('catus-0') ? true : undefined,
    );

    await app.automation('new-tab').rightClick();
    await app.automation('tmux-session-menu').visibleTarget();
    await app.automation('tmux-session-catus-0').visibleTarget();
    await app.automation('tmux-session-row-catus-0').hover();
    await app.automation('close-tmux-session-catus-0').visibleTarget();
    await writeFile(
      '.tmp/e2e/artifacts/tmux-session-menu.png',
      await app.automation('tmux-session-menu').screenshot(),
    );
    await app.tap('.tmux-session-menu-dismiss');
    await waitFor('dismissed session menu', async () =>
      !(await app.automation('tmux-session-menu').node()) ? true : undefined,
    );

    // The menu starts the next prefixed session in a new tab.
    await app.automation('new-tab').rightClick();
    await app.automation('tmux-new-session').tap();
    await waitFor('session tab', async () => {
      const node = await app.automation('terminal-surface').node();
      return node && app.attribute(node, 'terminal-id') === '2' ? node : undefined;
    });
    await waitFor('incremented tmux session', async () =>
      app.tmuxSessions().includes('catus-1') ? true : undefined,
    );
    expect(app.tmuxWindows('catus-1')).toEqual(['tab-2']);
    expect(await app.sessionExists(2)).toBe(true);

    // Closing the tab detaches, the session stays listed and can be killed.
    await app.automation('close-tab-2').tap();
    await waitFor('detached session tab', async () =>
      !(await app.sessionExists(2)) ? true : undefined,
    );
    expect(app.tmuxSessions()).toEqual(expect.arrayContaining(['catus-0', 'catus-1']));
    await app.automation('new-tab').rightClick();
    await app.automation('tmux-session-row-catus-1').hover();
    await app.automation('close-tmux-session-catus-1').tap();
    await waitFor('closed tmux session', async () =>
      !app.tmuxSessions().includes('catus-1') ? true : undefined,
    );
    expect(app.tmuxSessions()).toEqual(['catus-0']);
  },
);
