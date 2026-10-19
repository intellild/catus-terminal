import { afterEach, beforeEach, expect, rstest, test } from '@rstest/core';
import { act, fireEvent, render } from '@lynx-js/react/testing-library';
import { TmuxTabBar } from '../components/Terminal/TmuxTabBar';
import type { TmuxSessionInfo } from '../../shared/tmux';

const first: TmuxSessionInfo = {
  activeWindowId: '@1',
  windows: [
    { id: '@1', index: 0, name: 'shell', active: true },
    { id: '@2', index: 1, name: 'logs', active: false },
  ],
};

let getTmuxSessionInfo: ReturnType<typeof rstest.fn>;
let selectTmuxWindow: ReturnType<typeof rstest.fn>;
let createTmuxWindow: ReturnType<typeof rstest.fn>;
let closeTmuxWindow: ReturnType<typeof rstest.fn>;

beforeEach(() => {
  rstest.useFakeTimers();
  getTmuxSessionInfo = rstest.fn(() => first);
  selectTmuxWindow = rstest.fn();
  createTmuxWindow = rstest.fn();
  closeTmuxWindow = rstest.fn();
  rstest.stubGlobal('NativeModules', {
    nodejs: {
      exposed: {
        getTmuxSessionInfo,
        selectTmuxWindow,
        createTmuxWindow,
        closeTmuxWindow,
      },
    },
  });
});

afterEach(() => {
  rstest.useRealTimers();
  rstest.unstubAllGlobals();
});

test('TmuxTabBar renders native windows, switches, creates and closes tmux tabs', async () => {
  render(<TmuxTabBar sessionId={7} />, { enableMainThread: true });
  const root = elementTree.root!;
  await rstest.waitFor(() =>
    expect(root.querySelector('[data-automation-id=tmux-window-1]')).not.toBeNull(),
  );
  expect(root.querySelector('[data-automation-id=tmux-tabs]')?.textContent).toContain('0: shell');
  expect(
    root.querySelector('[data-automation-id=tmux-window-0]')?.getAttribute('data-active'),
  ).toBe('true');

  fireEvent.tap(root.querySelector('[data-automation-id=tmux-window-1]')!);
  expect(selectTmuxWindow).toHaveBeenCalledWith(7, '@2');
  fireEvent.tap(root.querySelector('[data-automation-id=tmux-new-window]')!);
  expect(createTmuxWindow).toHaveBeenCalledWith(7);
  fireEvent.tap(root.querySelector('[data-automation-id=close-tmux-window-0]')!, {
    eventType: 'catchEvent',
    bubbles: true,
  });
  expect(closeTmuxWindow).toHaveBeenCalledWith(7, '@1');

  getTmuxSessionInfo.mockReturnValue({ ...first, windows: [first.windows[0]!] });
  await act(async () => {
    rstest.advanceTimersByTime(400);
  });
  await rstest.waitFor(() =>
    expect(root.querySelector('[data-automation-id=tmux-window-1]')).toBeNull(),
  );
  expect(root.querySelector('[data-automation-id=close-tmux-window-0]')).toBeNull();
});
