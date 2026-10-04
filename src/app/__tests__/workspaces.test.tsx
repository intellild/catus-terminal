import '@testing-library/jest-dom';
import { beforeEach, expect, test, rstest } from '@rstest/core';
import { act, fireEvent, getQueriesForElement, render } from '@lynx-js/react/testing-library';
import defaults from '../../../config/workspaces.json';
import { App } from '../App';
import { parseWorkspaceConfig } from '../../shared/workspaces';
import type { WorkspaceHost, WorkspaceConfig } from '../../shared/workspaces';

beforeEach(() => {
  // Testing-library resolves selectors but does not implement native UI methods.
  const query = lynx.createSelectorQuery() as unknown as { selectUniqueID(id: number): object };
  const prototype = Object.getPrototypeOf(query.selectUniqueID(0));
  rstest.spyOn(prototype, 'invoke').mockReturnValue({ exec: rstest.fn() });
  let next = 0;
  rstest.stubGlobal('NativeModules', {
    nodejs: {
      exposed: {
        createDefaultTerminal: rstest.fn(() => ({
          nativeId: `test-terminal-${++next}`,
          close: rstest.fn(),
        })),
      },
    },
  });
  // Main-thread APIs live in a separate testing global. RAF stays manually driven.
  const main = (
    globalThis as unknown as {
      lynxTestingEnv: { mainThread: { globalThis: { lynx: Record<string, unknown> } } };
    }
  ).lynxTestingEnv.mainThread.globalThis;
  Object.assign(main.lynx, {
    requestAnimationFrame: rstest.fn(() => 1),
    cancelAnimationFrame: rstest.fn(),
  });
  Object.assign(main, {
    requestAnimationFrame: rstest.fn(() => 1),
    cancelAnimationFrame: rstest.fn(),
    __InvokeUIMethod: rstest.fn(),
  });
});

function makeHost() {
  const payload = {
    config: parseWorkspaceConfig(defaults),
    path: '/tmp/catus/workspaces.json',
    environment: { shell: '/bin/zsh', home: '/Users/test' },
  };
  const host: WorkspaceHost = {
    loadWorkspaces: rstest.fn(async () => payload),
    saveWorkspaces: rstest.fn(async (config: WorkspaceConfig) => ({ ...payload, config })),
  };
  return host;
}

test('main-thread first frame renders the layout and region fallbacks without loading the host', () => {
  const host = makeHost();
  render(<App host={host} />, { enableMainThread: true, enableBackgroundThread: false });
  const root = elementTree.root!;
  for (const id of [
    'application-layout',
    'window-tab-bar',
    'window-controls-space',
    'workspace-dock',
    'terminal-content',
    'application-status',
  ]) {
    expect(root.querySelector(`#${id}`)).not.toBeNull();
  }
  expect(root.querySelector('#terminal-placeholder')?.textContent).toBe('Getting things ready.');
  expect(root.querySelector('#tab-1')).toBeNull();
  expect(host.loadWorkspaces).not.toHaveBeenCalled();
});

test('Lynx tabs and dock indicators follow workspace startup, switching, creation and closing', async () => {
  render(<App host={makeHost()} />, { enableMainThread: true });
  const root = elementTree.root!;
  const { findByText } = getQueriesForElement(root);
  await rstest.waitFor(() => expect(root.querySelector('#terminal-surface')).not.toBeNull());
  expect(root.querySelector('#session-directory')?.textContent).toBe(
    'Default shell · home directory',
  );
  const firstId = root.querySelector('#terminal-surface')?.getAttribute('terminal-id');
  expect(root.querySelector('#running-shell')).not.toBeNull();
  expect(root.querySelector('#running-node')).toBeNull();
  fireEvent.tap(root.querySelector('#workspace-node')!);
  await findByText('Node.js 2');
  expect(root.querySelector('#running-node')).not.toBeNull();
  fireEvent.tap(root.querySelector('#workspace-node')!);
  expect(root.querySelector('#tab-3')).toBeNull();
  fireEvent.tap(root.querySelector('#new-tab')!);
  await findByText('Node.js 3');
  fireEvent.tap(root.querySelector('#workspace-shell')!);
  await findByText('Shell 1');
  await rstest.waitFor(() =>
    expect(root.querySelector('#terminal-surface')?.getAttribute('terminal-id')).toBe(firstId),
  );
  expect(root.querySelector('#tab-2')).toBeNull();
  fireEvent.tap(root.querySelector('#workspace-node')!);
  await findByText('Node.js 3');
  fireEvent.tap(root.querySelector('#close-tab-3')!);
  fireEvent.tap(root.querySelector('#close-tab-2')!);
  await findByText('Open a terminal tab in this workspace.');
  expect(root.querySelector('#running-node')).toBeNull();
  expect(root.querySelector('#running-shell')).not.toBeNull();
  fireEvent.tap(root.querySelector('#start-terminal')!);
  await findByText('Node.js 4');
});

test('workspace editor persists JSON and rejects invalid arguments without saving', async () => {
  const host = makeHost();
  render(<App host={host} />);
  const root = elementTree.root!;
  const { findByText } = getQueriesForElement(root);
  await rstest.waitFor(() => expect(root.querySelector('#terminal-surface')).not.toBeNull());
  fireEvent.tap(root.querySelector('#workspace-settings')!);
  await findByText('Launch profile');
  const input = root.querySelector('#profile-args')!;
  act(() => {
    input.dispatchEvent(new CustomEvent('bindEvent:input', { detail: { value: 'invalid' } }));
  });
  fireEvent.tap(root.querySelector('#save-workspace')!);
  expect(host.saveWorkspaces).not.toHaveBeenCalled();
  expect(root.querySelector('#editor-error')).not.toBeNull();
  act(() => {
    input.dispatchEvent(new CustomEvent('bindEvent:input', { detail: { value: '["-l", "-i"]' } }));
  });
  fireEvent.tap(root.querySelector('#save-workspace')!);
  await rstest.waitFor(() => expect(host.saveWorkspaces).toHaveBeenCalledOnce());
  expect(rstest.mocked(host.saveWorkspaces).mock.calls[0]![0].workspaces[0]!.args).toEqual([
    '-l',
    '-i',
  ]);
  // Workspace edits do not change the minimal terminal's default shell.
  expect(root.querySelector('#session-directory')?.textContent).toBe(
    'Default shell · home directory',
  );
});

test('adding a workspace leaves it stopped until activated, and removing it closes its tabs', async () => {
  const host = makeHost();
  render(<App host={host} />);
  const root = elementTree.root!;
  const { findByText } = getQueriesForElement(root);
  await rstest.waitFor(() => expect(root.querySelector('#terminal-surface')).not.toBeNull());
  fireEvent.tap(root.querySelector('#workspace-settings')!);
  fireEvent.tap(root.querySelector('#add-workspace')!);
  fireEvent.tap(root.querySelector('#save-workspace')!);
  await rstest.waitFor(() => expect(root.querySelector('#workspace-workspace-1')).not.toBeNull());
  expect(root.querySelector('#running-workspace-1')).toBeNull();
  fireEvent.tap(root.querySelector('#workspace-workspace-1')!);
  await findByText('New workspace 2');
  expect(root.querySelector('#running-workspace-1')).not.toBeNull();
  fireEvent.tap(root.querySelector('#workspace-settings')!);
  fireEvent.tap(root.querySelector('#delete-workspace')!);
  await findByText('Shell 1');
  expect(root.querySelector('#workspace-workspace-1')).toBeNull();
  expect(root.querySelector('#tab-2')).toBeNull();
  expect(rstest.mocked(host.saveWorkspaces).mock.calls[1]![0].workspaces).toHaveLength(3);
});

test('closing terminal content releases its PTY instances', async () => {
  const { unmount } = render(<App host={makeHost()} />);
  await rstest.waitFor(() =>
    expect(elementTree.root!.querySelector('#terminal-surface')).not.toBeNull(),
  );
  const factory = (NativeModules.nodejs.exposed as { createDefaultTerminal(): { close(): void } })
    .createDefaultTerminal;
  const session = rstest.mocked(factory).mock.results[0]!.value!;
  expect(session.close).not.toHaveBeenCalled();
  unmount();
  expect(session.close).toHaveBeenCalledOnce();
});

test('main-thread RAF waits for native completion and cancels on terminal unmount', async () => {
  const main = lynxTestingEnv.mainThread.globalThis;
  const pending: Array<() => void> = [];
  const raf = rstest.fn((callback: () => void) => {
    pending.push(callback);
    return pending.length;
  });
  const cancel = rstest.fn();
  let complete: ((result: { code: number; data: boolean }) => void) | undefined;
  const invoke = rstest.fn(
    (_element: unknown, method: string, _params: unknown, callback: typeof complete) => {
      if (method === 'renderFrame') complete = callback;
      else callback?.({ code: 0, data: true });
    },
  );
  Object.assign(main, {
    requestAnimationFrame: raf,
    cancelAnimationFrame: cancel,
    __InvokeUIMethod: invoke,
  });
  Object.assign(main.lynx, { requestAnimationFrame: raf, cancelAnimationFrame: cancel });
  const { unmount } = render(<App host={makeHost()} />);
  await rstest.waitFor(() => expect(pending).toHaveLength(1));
  lynxTestingEnv.switchToMainThread();
  try {
    pending[0]!();
    expect(invoke.mock.calls[0]![1]).toBe('renderFrame');
    expect(pending).toHaveLength(1); // No next frame while native rendering is in flight.
    complete!({ code: 0, data: true });
    await Promise.resolve();
    expect(pending).toHaveLength(2);
    expect(invoke.mock.calls[1]![1]).toBe('focus');
  } finally {
    lynxTestingEnv.switchToBackgroundThread();
  }
  unmount();
  expect(cancel).toHaveBeenCalledWith(2);
});

test('terminal forwards control keys to the native PTY and keeps macOS shortcuts with the host', async () => {
  render(<App host={makeHost()} />);
  await rstest.waitFor(() =>
    expect(elementTree.root!.querySelector('#terminal-surface')).not.toBeNull(),
  );
  const query = lynx.createSelectorQuery() as unknown as { selectUniqueID(id: number): object };
  const invoke = rstest.spyOn(Object.getPrototypeOf(query.selectUniqueID(0)), 'invoke');
  invoke.mockClear();
  const surface = elementTree.root!.querySelector('#terminal-surface')!;
  const key = (metaKey: boolean) => {
    act(() => {
      surface.dispatchEvent(
        Object.assign(new Event('catchEvent:keydown'), {
          eventType: 'catchEvent',
          eventName: 'keydown',
          key: 'c',
          ctrlKey: true,
          altKey: false,
          metaKey,
        }),
      );
    });
  };
  key(false);
  expect(invoke).toHaveBeenLastCalledWith({
    method: 'key',
    params: { key: 'c', control: true, alt: false },
  });
  key(true);
  expect(invoke).toHaveBeenCalledOnce();
});
