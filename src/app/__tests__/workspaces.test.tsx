import '@testing-library/jest-dom';
import { beforeEach, expect, test, rstest } from '@rstest/core';
import { act, fireEvent, getQueriesForElement, render } from '@lynx-js/react/testing-library';
import defaults from '../../../tests/fixtures/workspaces.json';
import { sftpClient } from '../api/sftp';
import { App } from '../App';
import { parseWorkspaceConfig } from '../../shared/workspaces';
import { sessionRegistry } from '../state/sessionRegistry';
import { startSessionRuntime } from '../state/sessionRuntime';
import { activeWorkspaceIdAtom, closeTab } from '../state/session';
import type { TerminalHost } from '../state/terminalSessions';
import type { WorkspaceHost, WorkspaceConfig } from '../../shared/workspaces';

beforeEach(() => {
  sessionRegistry.reset();
  Object.assign(lynxTestingEnv.mainThread.globalThis, {
    requestAnimationFrame: rstest.fn(() => 1),
    cancelAnimationFrame: rstest.fn(),
  });
  // Lynx UI Presence schedules its visibility transitions through BTS RAF.
  Object.assign(lynx, { requestAnimationFrame: (callback: () => void) => setTimeout(callback, 0) });
  // Testing-library resolves selectors but does not implement native UI methods.
  const query = lynx.createSelectorQuery() as unknown as { selectUniqueID(id: number): object };
  const prototype = Object.getPrototypeOf(query.selectUniqueID(0));
  rstest.spyOn(prototype, 'invoke').mockImplementation(function (
    this: { _nodeSelectToken: { type: number; identifier: string } },
    argument: unknown,
  ) {
    const options = argument as {
      method: string;
      params?: { value: string };
      success?(result: unknown): void;
    };
    return {
      exec: () => {
        if (options.method === 'boundingClientRect') {
          options.success?.({ left: 0, top: 0, width: 470, height: 34 });
        }
        if (options.method === 'setValue') {
          const token = this._nodeSelectToken;
          const input = (
            token.type === 0
              ? elementTree.root?.querySelector(token.identifier)
              : elementTree.uniqueId2Element.get(Number(token.identifier))
          ) as HTMLInputElement;
          input.value = options.params!.value;
          options.success?.({});
        }
      },
    };
  });
  rstest.stubGlobal('NativeModules', {
    nodejs: {
      exposed: {
        createTerminalSession: rstest.fn(),
        closeTerminalSession: rstest.fn(),
      },
    },
  });
});

async function changeInput(
  root: NonNullable<typeof elementTree.root>,
  selector: string,
  value: string,
) {
  const input = root.querySelector(selector)!;
  const event = new Event('bindEvent:input');
  // Testing-library copies enumerable fields into the MTS event payload.
  Object.defineProperties(event, {
    currentTarget: { value: { elementRefptr: input }, enumerable: true },
    detail: {
      value: {
        value,
        selectionStart: value.length,
        selectionEnd: value.length,
        isComposing: false,
      },
      enumerable: true,
    },
  });
  await act(async () => {
    input.dispatchEvent(event);
  });
}

async function contextMenu(root: NonNullable<typeof elementTree.root>, id: string) {
  fireEvent(
    root.querySelector(`#workspace-${id}`)!,
    Object.assign(new CustomEvent('bindEvent:mousedown'), {
      button: 0,
      buttons: 2,
      pageX: 30,
      pageY: 120,
    }),
  );
  await rstest.waitFor(() => expect(root.querySelector('#workspace-context-menu')).not.toBeNull());
}
async function openEditor(root: NonNullable<typeof elementTree.root>, id = 'shell') {
  await contextMenu(root, id);
  fireEvent.tap(root.querySelector('#workspace-menu-edit')!);
}

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
    listShells: rstest.fn(async () => [{ value: '/bin/zsh', label: 'zsh · /bin/zsh' }]),
    loadWorkspaces: rstest.fn(async () => payload),
    saveWorkspaces: rstest.fn(async (config: WorkspaceConfig) => ({ ...payload, config })),
  };
  return host;
}

function renderApp(host = makeHost()) {
  act(() => startSessionRuntime(sessionRegistry, host));
  return render(<App />, { enableMainThread: true });
}

test('main-thread first frame renders the layout and region fallbacks without loading the host', () => {
  const host = makeHost();
  render(<App />, { enableMainThread: true, enableBackgroundThread: false });
  const root = elementTree.root!;
  for (const id of [
    'application-layout',
    'window-tab-bar',
    'tab-bar-scroll',
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

test('background hydration preserves the main-thread layout nodes', async () => {
  const main = lynxTestingEnv.mainThread.globalThis;
  lynxTestingEnv.switchToMainThread();
  const renderPage = Reflect.get(globalThis, 'renderPage') as (...args: unknown[]) => unknown;
  lynxTestingEnv.switchToBackgroundThread();
  const ids = [
    'application-layout',
    'window-tab-bar',
    'tab-bar-scroll',
    'window-controls-space',
    'workspace-dock',
    'terminal-content',
    'application-status',
  ];
  let firstFrame: { id: string; element: unknown }[] = [];
  // Capture the native element tree after IFR, before testing-library hydrates BTS.
  main.renderPage = (...args: unknown[]) => {
    const result = renderPage(...args);
    firstFrame = ids.map((id) => ({ id, element: elementTree.root!.querySelector(`#${id}`) }));
    return result;
  };
  try {
    renderApp();
  } finally {
    delete main.renderPage;
  }
  await waitForTerminal();
  expect(firstFrame).toHaveLength(ids.length);
  for (const { id, element } of firstFrame) {
    expect(element).not.toBeNull();
    expect(elementTree.root!.querySelector(`#${id}`)).toBe(element);
  }
});

test('the native view stays mounted through empty/loading/error states with one app RAF driver', async () => {
  const main = lynxTestingEnv.mainThread.globalThis;
  const raf = rstest.fn();
  const invoke = rstest.fn();
  Object.assign(main, { requestAnimationFrame: raf, __InvokeUIMethod: invoke });
  const host = makeHost();
  rstest.mocked(host.loadWorkspaces).mockRejectedValueOnce(new Error('Temporary config error'));
  const { unmount } = renderApp(host);
  const root = elementTree.root!;
  await rstest.waitFor(() => expect(root.querySelector('#config-error')).not.toBeNull());
  const surface = root.querySelector('#terminal-surface')!;
  expect(Number(surface.getAttribute('terminal-id'))).toBe(0);
  expect(raf).toHaveBeenCalledOnce();
  expect(invoke).not.toHaveBeenCalled();
  fireEvent.tap(root.querySelector('#retry-config')!);
  await waitForTerminal();
  expect(root.querySelector('#terminal-surface')).toBe(surface);
  expect(raf).toHaveBeenCalledOnce();
  const terminalHost = NativeModules.nodejs.exposed as TerminalHost;
  expect(terminalHost.createTerminalSession).toHaveBeenCalledOnce();
  expect(terminalHost.closeTerminalSession).not.toHaveBeenCalled();
  unmount();
  expect(terminalHost.closeTerminalSession).not.toHaveBeenCalled();
});

test('Lynx tabs and dock indicators follow workspace startup, switching, creation and closing', async () => {
  renderApp();
  const root = elementTree.root!;
  const { findByText } = getQueriesForElement(root);
  await waitForTerminal();
  expect(root.querySelector('#session-directory')?.textContent).toBe('$SHELL');
  const surface = root.querySelector('#terminal-surface')!;
  const firstId = surface.getAttribute('terminal-id');
  const terminalHost = NativeModules.nodejs.exposed as TerminalHost;
  expect(terminalHost.createTerminalSession).toHaveBeenCalledOnce();
  expect(root.querySelector('#running-shell')).not.toBeNull();
  expect(root.querySelector('#running-local')).toBeNull();
  fireEvent.tap(root.querySelector('#workspace-local')!);
  await findByText('Local 2');
  expect(root.querySelector('#running-local')).not.toBeNull();
  fireEvent.tap(root.querySelector('#workspace-local')!);
  expect(root.querySelector('#tab-3')).toBeNull();
  fireEvent.tap(root.querySelector('#new-tab')!);
  await findByText('Local 3');
  fireEvent.tap(root.querySelector('#workspace-shell')!);
  await findByText('Shell 1');
  await rstest.waitFor(() =>
    expect(root.querySelector('#terminal-surface')?.getAttribute('terminal-id')).toBe(firstId),
  );
  expect(root.querySelector('#tab-2')).toBeNull();
  expect(root.querySelector('#terminal-surface')).toBe(surface);
  expect(terminalHost.createTerminalSession).toHaveBeenCalledTimes(3);
  expect(rstest.mocked(terminalHost.createTerminalSession).mock.calls.map(([id]) => [id])).toEqual([
    [1],
    [2],
    [3],
  ]);
  expect(terminalHost.closeTerminalSession).not.toHaveBeenCalled();
  fireEvent.tap(root.querySelector('#workspace-local')!);
  await findByText('Local 3');
  fireEvent.tap(root.querySelector('#close-tab-3')!, { eventType: 'catchEvent', bubbles: true });
  fireEvent.tap(root.querySelector('#close-tab-2')!, { eventType: 'catchEvent', bubbles: true });
  await findByText('Open a terminal tab in this workspace.');
  expect(root.querySelector('#running-local')).toBeNull();
  expect(root.querySelector('#running-shell')).not.toBeNull();
  expect(root.querySelector('#terminal-surface')).toBe(surface);
  await rstest.waitFor(() => expect(Number(surface.getAttribute('terminal-id'))).toBe(0));
  expect(terminalHost.closeTerminalSession).toHaveBeenCalledTimes(2);
  expect(terminalHost.closeTerminalSession).toHaveBeenCalledWith(3);
  expect(terminalHost.closeTerminalSession).toHaveBeenCalledWith(2);
  expect(terminalHost.closeTerminalSession).not.toHaveBeenCalledWith(Number(firstId));
  fireEvent.tap(root.querySelector('#start-terminal')!);
  await findByText('Local 4');
  await waitForTerminal();
  expect(root.querySelector('#terminal-surface')).toBe(surface);
});

test('workspace editor validates fields, switches local/SSH, previews and persists the launch profile', async () => {
  const host = makeHost();
  renderApp(host);
  const root = elementTree.root!;
  await waitForTerminal();
  await openEditor(root);
  await rstest.waitFor(() => expect(root.querySelector('#profile-shell')).not.toBeNull());
  fireEvent.tap(root.querySelector('#profile-shell')!);
  await rstest.waitFor(() =>
    expect(root.querySelector('#profile-shell-option-custom')).not.toBeNull(),
  );
  fireEvent.tap(root.querySelector('#profile-shell-option-custom')!);
  await changeInput(root, '#profile-command', 'printf hello');
  fireEvent.tap(root.querySelector('#workspace-type-ssh')!);
  expect(root.querySelector('#profile-command')).not.toBeNull();
  fireEvent.tap(root.querySelector('#save-workspace')!);
  expect(host.saveWorkspaces).not.toHaveBeenCalled();
  expect(root.querySelector('#editor-error')).not.toBeNull();
  await changeInput(root, '#profile-host', 'user@server');
  await changeInput(root, '#profile-remoteCommand', 'cd /srv && exec bash -l');
  expect(root.querySelector('#ssh-command-preview')?.textContent).toBe(
    "'ssh' '-t' '--' 'user@server' 'cd /srv && exec bash -l; printf hello'",
  );
  fireEvent.tap(root.querySelector('#workspace-type-local')!);
  expect((root.querySelector('#profile-command') as HTMLInputElement).value).toBe('printf hello');
  fireEvent.tap(root.querySelector('#workspace-type-ssh')!);
  fireEvent.tap(root.querySelector('#save-workspace')!);
  await rstest.waitFor(() => expect(host.saveWorkspaces).toHaveBeenCalledOnce());
  const profile = rstest.mocked(host.saveWorkspaces).mock.calls[0]![0].workspaces[0]!;
  expect(profile).toMatchObject({
    type: 'ssh',
    host: 'user@server',
    remoteCommand: 'cd /srv && exec bash -l',
    command: 'printf hello',
    shell: 'custom',
    args: [],
  });
  // Already running terminals keep their old profile.
  expect(root.querySelector('#session-directory')?.textContent).toBe('$SHELL');
});

test('adding a workspace leaves it stopped until activated, and removing it closes its tabs', async () => {
  const host = makeHost();
  renderApp(host);
  const root = elementTree.root!;
  const { findByText } = getQueriesForElement(root);
  await waitForTerminal();
  fireEvent.tap(root.querySelector('#add-workspace')!);
  fireEvent.tap(root.querySelector('#save-workspace')!);
  await rstest.waitFor(() => expect(root.querySelector('#workspace-workspace-1')).not.toBeNull());
  expect(root.querySelector('#running-workspace-1')).toBeNull();
  fireEvent.tap(root.querySelector('#workspace-workspace-1')!);
  await findByText('New workspace 2');
  expect(root.querySelector('#running-workspace-1')).not.toBeNull();
  await contextMenu(root, 'workspace-1');
  fireEvent.tap(root.querySelector('#workspace-menu-delete')!);
  await findByText('Shell 1');
  expect(root.querySelector('#workspace-workspace-1')).toBeNull();
  expect(root.querySelector('#tab-2')).toBeNull();
  expect(rstest.mocked(host.saveWorkspaces).mock.calls[1]![0].workspaces).toHaveLength(
    defaults.workspaces.length,
  );
});

test('React unmount and remount preserve global sessions; atom writes release them', async () => {
  const { unmount } = renderApp();
  await waitForTerminal();
  const host = NativeModules.nodejs.exposed as TerminalHost;
  const id = rstest.mocked(host.createTerminalSession).mock.calls[0]![0];
  expect(host.closeTerminalSession).not.toHaveBeenCalled();
  unmount();
  expect(host.closeTerminalSession).not.toHaveBeenCalled();
  renderApp();
  await waitForTerminal();
  expect(host.createTerminalSession).toHaveBeenCalledOnce();
  expect(
    Number(elementTree.root!.querySelector('#terminal-surface')!.getAttribute('terminal-id')),
  ).toBe(id);
  act(() => closeTab(sessionRegistry, id));
  expect(host.closeTerminalSession).toHaveBeenCalledOnce();
  expect(host.closeTerminalSession).toHaveBeenCalledWith(id);
});

test('terminal forwards control keys to the native PTY and keeps macOS shortcuts with the host', async () => {
  renderApp();
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

test('SSH has separate terminal and SFTP buttons; directory navigation preserves the native view', async () => {
  const upload = rstest.spyOn(sftpClient, 'uploadFiles').mockResolvedValue(true);
  const fs = {
    realpath: rstest.fn(async (path: string) =>
      path === '.' ? '/srv/users/home/test' : path.endsWith('/..') ? '/srv/users/home/test' : path,
    ),
    readdir: rstest.fn(async (path: string) =>
      path.endsWith('/docs')
        ? []
        : [
            {
              name: '.env',
              isDirectory: () => false,
              isFile: () => true,
              isSymbolicLink: () => false,
            },
            {
              name: '.cache',
              isDirectory: () => true,
              isFile: () => false,
              isSymbolicLink: () => false,
            },
            {
              name: 'docs',
              isDirectory: () => true,
              isFile: () => false,
              isSymbolicLink: () => false,
            },
          ],
    ),
    stat: rstest.fn(),
    close: rstest.fn(async () => {}),
  };
  const terminal = NativeModules.nodejs.exposed as TerminalHost & {
    connectSftp: ReturnType<typeof rstest.fn>;
  };
  terminal.connectSftp = rstest.fn(async () => fs);
  const host = makeHost();
  const payload = await host.loadWorkspaces();
  rstest.mocked(host.loadWorkspaces).mockResolvedValue({
    ...payload,
    config: {
      version: 1,
      workspaces: [{ ...payload.config.workspaces[0]!, type: 'ssh', host: 'test-alias' }],
    },
  });
  renderApp(host);
  await waitForTerminal();
  const root = elementTree.root!;
  const surface = root.querySelector('#terminal-surface');
  expect(root.querySelector('#new-sftp-tab')).not.toBeNull();
  const list = () =>
    root.querySelector('#sftp-list')! as Parameters<typeof elementTree.enterListItemAtIndex>[0];
  let visibleCells: number[] = [];
  // The test host has no viewport: simulate native requests and recycling.
  const visibleText = (count: number) => {
    visibleCells.forEach((cell) => elementTree.leaveListItem(list(), cell));
    visibleCells = [];
    for (let index = 0; index < count; index++) {
      visibleCells.push(elementTree.enterListItemAtIndex(list(), index));
    }
    return visibleCells
      .map((cell) => elementTree.__GetElementByUniqueId(cell)!.textContent)
      .join('');
  };
  fireEvent.tap(root.querySelector('#new-sftp-tab')!);
  await rstest.waitFor(() => expect(visibleText(1)).toContain('docs'));
  expect(root.querySelector('#sftp-path')?.textContent).toBe('…›users›home›test');
  expect(visibleText(1)).not.toContain('.env');
  expect(root.querySelector('#session-label')).toBeNull();
  expect(root.querySelector('#session-directory')).toBeNull();
  expect(visibleText(1)).not.toContain('.cache');
  fireEvent.tap(root.querySelector('#sftp-show-hidden')!);
  await rstest.waitFor(() => expect(visibleText(3)).toContain('.cache'));
  expect(visibleText(3)).toContain('.env');
  fireEvent.tap(root.querySelector('#sftp-show-hidden')!);
  await rstest.waitFor(() => expect(visibleText(1)).not.toContain('.cache'));
  expect(visibleText(1)).not.toContain('.env');
  expect(terminal.createTerminalSession).toHaveBeenCalledOnce();
  expect(Number(surface!.getAttribute('terminal-id'))).toBe(0);
  fireEvent.tap(
    elementTree.__GetElementByUniqueId(visibleCells[0]!)!.querySelector('#sftp-entry-0')!,
  );
  await rstest.waitFor(() => {
    visibleText(1);
    expect(
      elementTree.__GetElementByUniqueId(visibleCells[0]!)!.querySelector('#sftp-empty'),
    ).not.toBeNull();
  });
  expect(fs.readdir).toHaveBeenLastCalledWith('/srv/users/home/test/docs', { withFileTypes: true });
  fireEvent.tap(root.querySelector('#sftp-up')!);
  await rstest.waitFor(() => expect(visibleText(1)).toContain('docs'));
  fireEvent.tap(root.querySelector('#sftp-breadcrumb-0')!);
  await rstest.waitFor(() =>
    expect(fs.readdir).toHaveBeenLastCalledWith('/srv/users', { withFileTypes: true }),
  );
  expect(root.querySelector('#sftp-breadcrumb-ellipsis')).toBeNull();
  expect(root.querySelector('#sftp-breadcrumb-current')?.textContent).toBe('users');
  const reads = fs.readdir.mock.calls.length;
  fireEvent.tap(root.querySelector('#sftp-upload')!);
  await rstest.waitFor(() => expect(fs.readdir.mock.calls.length).toBeGreaterThan(reads));
  expect(upload).toHaveBeenCalledWith('test-alias', '/srv/users');
  fireEvent.tap(root.querySelector('#tab-1')!);
  expect(root.querySelector('#terminal-surface')).toBe(surface);
  expect(Number(surface!.getAttribute('terminal-id'))).toBe(1);
  expect(fs.close).not.toHaveBeenCalled();
  fireEvent.tap(root.querySelector('#tab-2')!);
  fireEvent.tap(root.querySelector('#close-tab-2')!, { eventType: 'catchEvent', bubbles: true });
  await rstest.waitFor(() => expect(fs.close).toHaveBeenCalledOnce());
  expect(terminal.closeTerminalSession).not.toHaveBeenCalled();
});

test('shell Select loads candidates, saves a selected shell and allows a custom remote command', async () => {
  const host = makeHost();
  renderApp(host);
  await waitForTerminal();
  const root = elementTree.root!;
  await openEditor(root);
  await rstest.waitFor(() => expect(host.listShells).toHaveBeenCalledWith(undefined));
  expect(root.querySelector('#profile-command')).toBeNull();
  fireEvent.tap(root.querySelector('#profile-shell')!);
  await rstest.waitFor(() => expect(root.querySelector('#profile-shell-option-1')).not.toBeNull());
  fireEvent.tap(root.querySelector('#profile-shell-option-1')!);
  fireEvent.tap(root.querySelector('#save-workspace')!);
  await rstest.waitFor(() => expect(host.saveWorkspaces).toHaveBeenCalledOnce());
  expect(rstest.mocked(host.saveWorkspaces).mock.calls[0]![0].workspaces[0]).toMatchObject({
    shell: '/bin/zsh',
    command: '/bin/zsh',
    args: ['-l'],
  });
  await rstest.waitFor(() => expect(root.querySelector('#profile-shell')).toBeNull());
  await openEditor(root);
  await rstest.waitFor(() => expect(root.querySelector('#profile-shell')).not.toBeNull());
  fireEvent.tap(root.querySelector('#workspace-type-ssh')!);
  await changeInput(root, '#profile-host', 'remote-alias');
  await rstest.waitFor(() => expect(host.listShells).toHaveBeenCalledWith('remote-alias'));
  expect(root.querySelector('#ssh-command-preview')?.textContent).toContain('exec');
  fireEvent.tap(root.querySelector('#profile-shell')!);
  await rstest.waitFor(() =>
    expect(root.querySelector('#profile-shell-option-custom')).not.toBeNull(),
  );
  fireEvent.tap(root.querySelector('#profile-shell-option-custom')!);
  await changeInput(root, '#profile-command', 'exec fish');
  fireEvent.tap(root.querySelector('#save-workspace')!);
  await rstest.waitFor(() => expect(host.saveWorkspaces).toHaveBeenCalledTimes(2));
  expect(rstest.mocked(host.saveWorkspaces).mock.calls[1]![0].workspaces[0]).toMatchObject({
    type: 'ssh',
    host: 'remote-alias',
    shell: 'custom',
    command: 'exec fish',
  });
});

test('right-click edits an inactive workspace without starting it; failed deletion can retry', async () => {
  const host = makeHost();
  renderApp(host);
  await waitForTerminal();
  const root = elementTree.root!;
  const terminal = NativeModules.nodejs.exposed as TerminalHost;
  await contextMenu(root, 'local');
  expect(root.querySelector('#workspace-context-menu')).not.toBeNull();
  expect(terminal.createTerminalSession).toHaveBeenCalledOnce();
  fireEvent.tap(root.querySelector('#workspace-menu-edit')!);
  expect((root.querySelector('#profile-name') as HTMLInputElement).value).toBe('Local');
  expect(root.querySelector('#delete-workspace')).toBeNull();
  expect(root.querySelector('#edit-profile-shell')).toBeNull();
  expect(sessionRegistry.get(activeWorkspaceIdAtom)).toBe('shell');
  fireEvent.tap(root.querySelector('#close-settings')!);
  fireEvent.tap(root.querySelector('#workspace-local')!);
  await rstest.waitFor(() => expect(terminal.createTerminalSession).toHaveBeenCalledTimes(2));
  fireEvent.tap(root.querySelector('#workspace-shell')!);
  await contextMenu(root, 'local');
  rstest.mocked(host.saveWorkspaces).mockRejectedValueOnce(new Error('Permission denied'));
  fireEvent.tap(root.querySelector('#workspace-menu-delete')!);
  await rstest.waitFor(() =>
    expect(root.querySelector('#workspace-menu-error')?.textContent).toContain('Permission denied'),
  );
  expect(root.querySelector('#workspace-local')).not.toBeNull();
  expect(terminal.closeTerminalSession).not.toHaveBeenCalled();
  fireEvent.tap(root.querySelector('#workspace-menu-delete')!);
  await rstest.waitFor(() => expect(root.querySelector('#workspace-local')).toBeNull());
  expect(terminal.closeTerminalSession).toHaveBeenCalledExactlyOnceWith(2);
  expect(sessionRegistry.get(activeWorkspaceIdAtom)).toBe('shell');
});

function hoverWorkspace(id: string, enter: boolean) {
  const trigger = elementTree.root!.querySelector(`#workspace-${id}`)!;
  const eventName = enter ? 'mouseenter' : 'mouseleave';
  fireEvent(
    trigger,
    Object.assign(new Event(`bindEvent:${eventName}`), { eventType: 'bindEvent', eventName }),
  );
}

test('workspace buttons show details on hover without starting or selecting a workspace', async () => {
  renderApp();
  await waitForTerminal();
  const root = elementTree.root!;
  const terminal = NativeModules.nodejs.exposed as TerminalHost;
  expect(root.querySelector('#workspace-local')?.textContent).not.toContain('Local');
  hoverWorkspace('local', true);
  await rstest.waitFor(() =>
    expect(root.querySelector('#workspace-details-local')?.textContent).toContain('Local'),
  );
  expect(root.querySelector('#workspace-details-local')?.textContent).toContain(
    'Working directory',
  );
  expect(sessionRegistry.get(activeWorkspaceIdAtom)).toBe('shell');
  expect(terminal.createTerminalSession).toHaveBeenCalledOnce();
  // Informational popovers must not install a screen-wide click interceptor.
  expect(root.querySelector('.workspace-menu-dismiss')).toBeNull();
  hoverWorkspace('local', false);
  await rstest.waitFor(() => expect(root.querySelector('#workspace-details-local')).toBeNull());
  hoverWorkspace('local', true);
  await rstest.waitFor(() => expect(root.querySelector('#workspace-details-local')).not.toBeNull());
  await contextMenu(root, 'local');
  await rstest.waitFor(() => expect(root.querySelector('#workspace-details-local')).toBeNull());
  expect(root.querySelector('#workspace-context-menu')).not.toBeNull();
});

test('hover deduplicates measurements and rejects responses from a previous visit', async () => {
  renderApp();
  await waitForTerminal();
  const root = elementTree.root!;
  const query = lynx.createSelectorQuery() as unknown as { selectUniqueID(id: number): object };
  const invoke = rstest.mocked(Object.getPrototypeOf(query.selectUniqueID(0)).invoke);
  const original = invoke.getMockImplementation()!;
  const responses: ((result: unknown) => void)[] = [];
  invoke.mockImplementation(function (
    this: unknown,
    options: { method: string; success(result: unknown): void },
  ) {
    if (options.method === 'boundingClientRect') {
      return {
        exec: () => {
          responses.push(options.success);
        },
      };
    }
    return original.call(this, options);
  });
  for (let count = 0; count < 25; count++) {
    hoverWorkspace('local', true);
  }
  expect(responses).toHaveLength(1);
  hoverWorkspace('local', false);
  hoverWorkspace('local', true);
  expect(responses).toHaveLength(2);
  act(() => responses[0]!({ left: 0, top: 0, width: 40, height: 40 }));
  expect(root.querySelector('#workspace-details-local')).toBeNull();
  act(() => responses[1]!({ left: 8, top: 100, width: 40, height: 40 }));
  await rstest.waitFor(() => expect(root.querySelector('#workspace-details-local')).not.toBeNull());
  const details = root.querySelector('#workspace-details-local')!;
  expect(details.className).toContain('pointer-events-none');
  expect(details.getAttribute('event-through')).toBe('true');
  hoverWorkspace('local', false);
  await rstest.waitFor(() => expect(root.querySelector('#workspace-details-local')).toBeNull());
});

test('leaving hover preserves styles during the delay and then removes the content', async () => {
  renderApp();
  await waitForTerminal();
  const root = elementTree.root!;
  for (let count = 0; count < 3; count++) {
    hoverWorkspace('local', true);
    await rstest.waitFor(() =>
      expect(root.querySelector('#workspace-details-local')).not.toBeNull(),
    );
    const details = root.querySelector('#workspace-details-local')!;
    const classes = details.className;
    expect(classes).toContain('bg-[#20262d]');
    hoverWorkspace('local', false);
    expect(root.querySelector('#workspace-details-local')).toBe(details);
    expect(details.className).toBe(classes);
    await rstest.waitFor(() => expect(root.querySelector('#workspace-details-local')).toBeNull());
    expect(details.className).toBe(classes);
  }
});

test('each workspace owns its menu and outside taps close the current instance', async () => {
  renderApp();
  await waitForTerminal();
  const root = elementTree.root!;
  for (const id of ['local', 'shell', 'local']) {
    await contextMenu(root, id);
    fireEvent.tap(root.querySelector('.workspace-menu-dismiss')!);
    await rstest.waitFor(() => expect(root.querySelector('#workspace-context-menu')).toBeNull());
    expect(root.querySelector('.workspace-menu-dismiss')).toBeNull();
  }
  await contextMenu(root, 'local');
  fireEvent.tap(root.querySelector('#workspace-menu-edit')!);
  expect((root.querySelector('#profile-name') as HTMLInputElement).value).toBe('Local');
  fireEvent.tap(root.querySelector('#close-settings')!);
  await rstest.waitFor(() => expect(root.querySelector('#workspace-context-menu')).toBeNull());
  await contextMenu(root, 'shell');
  fireEvent.tap(root.querySelector('#workspace-menu-edit')!);
  expect((root.querySelector('#profile-name') as HTMLInputElement).value).toBe('Shell');
});
