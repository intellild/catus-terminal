import '@testing-library/jest-dom';
import { beforeEach, expect, test, rstest } from '@rstest/core';
import { act, fireEvent, getQueriesForElement, render } from '@lynx-js/react/testing-library';
import defaults from '../../../config/workspaces.json';
import { App } from '../App';
import { parseWorkspaceConfig } from '../../shared/workspaces';
import { sessionRegistry } from '../state/sessionRegistry';
import { closeTab, sessionAtom } from '../state/session';
import type { TerminalHost } from '../state/terminalSessions';
import type { WorkspaceHost, WorkspaceConfig } from '../../shared/workspaces';

beforeEach(() => {
  sessionRegistry.reset();
  // Testing-library resolves selectors but does not implement native UI methods.
  const query = lynx.createSelectorQuery() as unknown as { selectUniqueID(id: number): object };
  const prototype = Object.getPrototypeOf(query.selectUniqueID(0));
  rstest.spyOn(prototype, 'invoke').mockReturnValue({ exec: rstest.fn() });
  rstest.stubGlobal('NativeModules', {
    nodejs: {
      exposed: {
        createTerminalSession: rstest.fn(),
        closeTerminalSession: rstest.fn(),
      },
    },
  });
});

async function waitForTerminal() {
  await rstest.waitFor(() =>
    expect(
      Number(elementTree.root!.querySelector('#terminal-surface')?.getAttribute('terminal-id')),
    ).toBeGreaterThan(0),
  );
}

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

test('the native view stays mounted through empty/loading/error states without JS frame scheduling', async () => {
  const main = lynxTestingEnv.mainThread.globalThis;
  const raf = rstest.fn();
  const invoke = rstest.fn();
  Object.assign(main, { requestAnimationFrame: raf, __InvokeUIMethod: invoke });
  const host = makeHost();
  rstest.mocked(host.loadWorkspaces).mockRejectedValueOnce(new Error('Temporary config error'));
  const { unmount } = render(<App host={host} />);
  const root = elementTree.root!;
  await rstest.waitFor(() => expect(root.querySelector('#config-error')).not.toBeNull());
  const surface = root.querySelector('#terminal-surface')!;
  expect(Number(surface.getAttribute('terminal-id'))).toBe(0);
  expect(raf).not.toHaveBeenCalled();
  expect(invoke).not.toHaveBeenCalled();
  fireEvent.tap(root.querySelector('#retry-config')!);
  await waitForTerminal();
  expect(root.querySelector('#terminal-surface')).toBe(surface);
  expect(raf).not.toHaveBeenCalled();
  const terminalHost = NativeModules.nodejs.exposed as TerminalHost;
  expect(terminalHost.createTerminalSession).toHaveBeenCalledOnce();
  expect(terminalHost.closeTerminalSession).not.toHaveBeenCalled();
  unmount();
  expect(terminalHost.closeTerminalSession).not.toHaveBeenCalled();
});

test('Lynx tabs and dock indicators follow workspace startup, switching, creation and closing', async () => {
  render(<App host={makeHost()} />, { enableMainThread: true });
  const root = elementTree.root!;
  const { findByText } = getQueriesForElement(root);
  await waitForTerminal();
  expect(root.querySelector('#session-directory')?.textContent).toBe(
    'Default shell · home directory',
  );
  const surface = root.querySelector('#terminal-surface')!;
  const firstId = surface.getAttribute('terminal-id');
  const terminalHost = NativeModules.nodejs.exposed as TerminalHost;
  expect(terminalHost.createTerminalSession).toHaveBeenCalledOnce();
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
  expect(root.querySelector('#terminal-surface')).toBe(surface);
  expect(terminalHost.createTerminalSession).toHaveBeenCalledTimes(3);
  expect(rstest.mocked(terminalHost.createTerminalSession).mock.calls).toEqual([[1], [2], [3]]);
  expect(terminalHost.closeTerminalSession).not.toHaveBeenCalled();
  fireEvent.tap(root.querySelector('#workspace-node')!);
  await findByText('Node.js 3');
  fireEvent.tap(root.querySelector('#close-tab-3')!);
  fireEvent.tap(root.querySelector('#close-tab-2')!);
  await findByText('Open a terminal tab in this workspace.');
  expect(root.querySelector('#running-node')).toBeNull();
  expect(root.querySelector('#running-shell')).not.toBeNull();
  expect(root.querySelector('#terminal-surface')).toBe(surface);
  await rstest.waitFor(() => expect(Number(surface.getAttribute('terminal-id'))).toBe(0));
  expect(terminalHost.closeTerminalSession).toHaveBeenCalledTimes(2);
  expect(terminalHost.closeTerminalSession).toHaveBeenCalledWith(3);
  expect(terminalHost.closeTerminalSession).toHaveBeenCalledWith(2);
  expect(terminalHost.closeTerminalSession).not.toHaveBeenCalledWith(Number(firstId));
  fireEvent.tap(root.querySelector('#start-terminal')!);
  await findByText('Node.js 4');
  await waitForTerminal();
  expect(root.querySelector('#terminal-surface')).toBe(surface);
});

test('workspace editor persists JSON and rejects invalid arguments without saving', async () => {
  const host = makeHost();
  render(<App host={host} />);
  const root = elementTree.root!;
  const { findByText } = getQueriesForElement(root);
  await waitForTerminal();
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
  await waitForTerminal();
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

test('React unmount and remount preserve global sessions; atom writes release them', async () => {
  const { unmount } = render(<App host={makeHost()} />);
  await waitForTerminal();
  const host = NativeModules.nodejs.exposed as TerminalHost;
  const id = rstest.mocked(host.createTerminalSession).mock.calls[0]![0];
  expect(host.closeTerminalSession).not.toHaveBeenCalled();
  unmount();
  expect(host.closeTerminalSession).not.toHaveBeenCalled();
  render(<App host={makeHost()} />);
  await waitForTerminal();
  expect(host.createTerminalSession).toHaveBeenCalledOnce();
  expect(
    Number(elementTree.root!.querySelector('#terminal-surface')!.getAttribute('terminal-id')),
  ).toBe(id);
  act(() => sessionRegistry.update(sessionAtom, (state) => closeTab(state, id)));
  expect(host.closeTerminalSession).toHaveBeenCalledOnce();
  expect(host.closeTerminalSession).toHaveBeenCalledWith(id);
});

test('terminal forwards control keys to the native PTY and keeps macOS shortcuts with the host', async () => {
  render(<App host={makeHost()} />);
  await waitForTerminal();
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
