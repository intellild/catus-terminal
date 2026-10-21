import '@testing-library/jest-dom';
import { afterEach, beforeEach, expect, test, rstest } from '@rstest/core';
import { act, fireEvent, getQueriesForElement, render } from '@lynx-js/react/testing-library';
import defaults from '../../../tests/fixtures/workspaces.json';
import { sftpClient } from '../api/sftp';
import { App } from '../app';
import { WorkspaceSettings } from '../components/workspace/workspace-settings';
import { parseWorkspaceConfig } from '../../shared/workspaces';
import { sessionRegistry } from '../state/session-registry';
import { startSessionRuntime } from '../state/session-runtime';
import { activeWorkspaceIdAtom, closeTab, createDraft } from '../state/session';
import type { TerminalHost } from '../state/terminal-sessions';
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

afterEach(() => {
  sessionRegistry.reset();
});

async function changeInput(
  root: NonNullable<typeof elementTree.root>,
  selector: string,
  value: string,
) {
  const input = root.querySelector(selector)! as HTMLInputElement;
  // Native editing updates the control before delivering the input event.
  input.value = value;
  const event = new Event('bindEvent:input');
  // Testing-library copies enumerable fields into the event payload.
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

async function openSettings(root: NonNullable<typeof elementTree.root>) {
  fireEvent.tap(root.querySelector('[data-automation-id=open-settings]')!);
  await rstest.waitFor(() =>
    expect(root.querySelector('[data-automation-id=settings-dialog]')).not.toBeNull(),
  );
}
async function openEditor(root: NonNullable<typeof elementTree.root>, id = 'shell') {
  await openSettings(root);
  fireEvent.tap(root.querySelector(`[data-automation-id=settings-host-${id}]`)!);
  await rstest.waitFor(() =>
    expect(root.querySelector('[data-automation-id=profile-name]')).not.toBeNull(),
  );
}

async function waitForTerminal() {
  await rstest.waitFor(() =>
    expect(
      Number(
        elementTree
          .root!.querySelector('[data-automation-id=terminal-surface]')
          ?.getAttribute('terminal-id'),
      ),
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

test('WorkspaceSettings renders a standalone form without a dialog shell', async () => {
  const draft = createDraft(parseWorkspaceConfig(defaults).workspaces).draft!;
  const onSave = rstest.fn();
  await act(async () => {
    render(
      <WorkspaceSettings
        draft={draft}
        saving={false}
        error=""
        shells={{ options: [], loading: false, error: '' }}
        onRetryShells={rstest.fn()}
        onChange={rstest.fn()}
        onSave={onSave}
      />,
      { enableMainThread: false },
    );
  });
  const root = elementTree.root!;
  expect(root.querySelector('[data-automation-id=workspace-editor-form]')).not.toBeNull();
  expect((root.querySelector('[data-automation-id=profile-name]') as HTMLInputElement).value).toBe(
    'New workspace',
  );
  expect(root.querySelector('[data-automation-id=workspace-dialog]')).toBeNull();
  expect(root.querySelector('[data-automation-id=close-settings]')).toBeNull();
  fireEvent.tap(root.querySelector('[data-automation-id=save-workspace]')!);
  await rstest.waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
});

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
    expect(root.querySelector(`[data-automation-id=${id}]`)).not.toBeNull();
  }
  expect(root.querySelector('[data-automation-id=terminal-placeholder]')?.textContent).toBe(
    'Getting things ready.',
  );
  expect(root.querySelector('[data-automation-id=tab-1]')).toBeNull();
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
    firstFrame = ids.map((id) => ({
      id,
      element: elementTree.root!.querySelector(`[data-automation-id=${id}]`),
    }));
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
    expect(elementTree.root!.querySelector(`[data-automation-id=${id}]`)).toBe(element);
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
  await rstest.waitFor(() =>
    expect(root.querySelector('[data-automation-id=config-error]')).not.toBeNull(),
  );
  const surface = root.querySelector('[data-automation-id=terminal-surface]')!;
  expect(Number(surface.getAttribute('terminal-id'))).toBe(0);
  expect(raf).toHaveBeenCalledOnce();
  expect(invoke).not.toHaveBeenCalled();
  fireEvent.tap(root.querySelector('[data-automation-id=retry-config]')!);
  await waitForTerminal();
  expect(root.querySelector('[data-automation-id=terminal-surface]')).toBe(surface);
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
  expect(root.querySelector('[data-automation-id=session-directory]')?.textContent).toBe('$SHELL');
  const surface = root.querySelector('[data-automation-id=terminal-surface]')!;
  const firstId = surface.getAttribute('terminal-id');
  const terminalHost = NativeModules.nodejs.exposed as TerminalHost;
  expect(terminalHost.createTerminalSession).toHaveBeenCalledOnce();
  expect(root.querySelector('[data-automation-id=running-shell]')).not.toBeNull();
  expect(root.querySelector('[data-automation-id=running-local]')).toBeNull();
  fireEvent.tap(root.querySelector('[data-automation-id=workspace-local]')!);
  await findByText('Local 2');
  expect(root.querySelector('[data-automation-id=running-local]')).not.toBeNull();
  fireEvent.tap(root.querySelector('[data-automation-id=workspace-local]')!);
  expect(root.querySelector('[data-automation-id=tab-3]')).toBeNull();
  fireEvent.tap(root.querySelector('[data-automation-id=new-tab]')!);
  await findByText('Local 3');
  fireEvent.tap(root.querySelector('[data-automation-id=workspace-shell]')!);
  await findByText('Shell 1');
  await rstest.waitFor(() =>
    expect(
      root.querySelector('[data-automation-id=terminal-surface]')?.getAttribute('terminal-id'),
    ).toBe(firstId),
  );
  expect(root.querySelector('[data-automation-id=tab-2]')).toBeNull();
  expect(root.querySelector('[data-automation-id=terminal-surface]')).toBe(surface);
  expect(terminalHost.createTerminalSession).toHaveBeenCalledTimes(3);
  expect(rstest.mocked(terminalHost.createTerminalSession).mock.calls.map(([id]) => [id])).toEqual([
    [1],
    [2],
    [3],
  ]);
  expect(terminalHost.closeTerminalSession).not.toHaveBeenCalled();
  fireEvent.tap(root.querySelector('[data-automation-id=workspace-local]')!);
  await findByText('Local 3');
  fireEvent.tap(root.querySelector('[data-automation-id=close-tab-3]')!, {
    eventType: 'catchEvent',
    bubbles: true,
  });
  fireEvent.tap(root.querySelector('[data-automation-id=close-tab-2]')!, {
    eventType: 'catchEvent',
    bubbles: true,
  });
  await findByText('Open a terminal tab in this workspace.');
  expect(root.querySelector('[data-automation-id=running-local]')).toBeNull();
  expect(root.querySelector('[data-automation-id=running-shell]')).not.toBeNull();
  expect(root.querySelector('[data-automation-id=terminal-surface]')).toBe(surface);
  await rstest.waitFor(() => expect(Number(surface.getAttribute('terminal-id'))).toBe(0));
  expect(terminalHost.closeTerminalSession).toHaveBeenCalledTimes(2);
  expect(terminalHost.closeTerminalSession).toHaveBeenCalledWith(3);
  expect(terminalHost.closeTerminalSession).toHaveBeenCalledWith(2);
  expect(terminalHost.closeTerminalSession).not.toHaveBeenCalledWith(Number(firstId));
  expect(root.querySelector('[data-automation-id=start-terminal] svg')).not.toBeNull();
  fireEvent.tap(root.querySelector('[data-automation-id=start-terminal]')!);
  await findByText('Local 4');
  await waitForTerminal();
  expect(root.querySelector('[data-automation-id=terminal-surface]')).toBe(surface);
});

test('switching between shell and tmux panels keeps the native terminal element', async () => {
  renderApp();
  const root = elementTree.root!;
  await waitForTerminal();
  const surface = root.querySelector('[data-automation-id=terminal-surface]')!;

  fireEvent.tap(root.querySelector('[data-automation-id=new-tmux-tab]')!);
  await rstest.waitFor(() =>
    expect(
      Number(
        root.querySelector('[data-automation-id=terminal-surface]')?.getAttribute('terminal-id'),
      ),
    ).toBe(2),
  );
  expect(root.querySelector('[data-automation-id=tmux-tabs]')).not.toBeNull();

  fireEvent.tap(root.querySelector('[data-automation-id=tab-1]')!);
  await rstest.waitFor(() =>
    expect(
      Number(
        root.querySelector('[data-automation-id=terminal-surface]')?.getAttribute('terminal-id'),
      ),
    ).toBe(1),
  );
  expect(root.querySelector('[data-automation-id=terminal-surface]')).toBe(surface);
  expect(root.querySelector('[data-automation-id=tmux-tabs]')).toBeNull();
});

test('workspace editor locks the existing host type and persists local changes', async () => {
  const host = makeHost();
  renderApp(host);
  const root = elementTree.root!;
  await waitForTerminal();
  await openEditor(root);
  await rstest.waitFor(() =>
    expect(root.querySelector('[data-automation-id=profile-shell]')).not.toBeNull(),
  );
  expect(root.querySelector('[data-automation-id=profile-default-tab-shell]')?.className).toContain(
    'bg-[#35483f]',
  );
  expect(root.querySelector('[data-automation-id=profile-default-tab-sftp]')?.className).toContain(
    'opacity-50',
  );
  fireEvent.tap(root.querySelector('[data-automation-id=profile-default-tab-tmux]')!);
  expect(root.querySelector('[data-automation-id=profile-default-tab-tmux]')?.className).toContain(
    'bg-[#35483f]',
  );
  expect(root.querySelector('[data-automation-id=profile-tmux]')).toBeNull();
  fireEvent.tap(root.querySelector('[data-automation-id=profile-shell]')!);
  await rstest.waitFor(() =>
    expect(root.querySelector('[data-automation-id=profile-shell-option-custom]')).not.toBeNull(),
  );
  fireEvent.tap(root.querySelector('[data-automation-id=profile-shell-option-custom]')!);
  await changeInput(root, '[data-automation-id=profile-command]', 'printf hello');
  // The type is chosen when the host is created and cannot change afterwards.
  expect(root.querySelector('[data-automation-id=workspace-type-ssh]')?.className).toContain(
    'opacity-50',
  );
  expect(root.querySelector('[data-automation-id=workspace-editor-form]')?.textContent).toContain(
    'The host type is fixed after creation.',
  );
  fireEvent.tap(root.querySelector('[data-automation-id=workspace-type-ssh]')!);
  await rstest.waitFor(() =>
    expect(root.querySelector('[data-automation-id=profile-host]')).toBeNull(),
  );
  fireEvent.tap(root.querySelector('[data-automation-id=save-workspace]')!);
  await rstest.waitFor(() => expect(host.saveWorkspaces).toHaveBeenCalledOnce());
  const profile = rstest.mocked(host.saveWorkspaces).mock.calls[0]![0].workspaces[0]!;
  expect(profile).toMatchObject({
    type: 'local',
    command: 'printf hello',
    shell: 'custom',
    args: [],
    defaultTab: 'tmux',
  });
  expect(profile).not.toHaveProperty('tmux');
  expect(profile).not.toHaveProperty('tmuxSessionName');
  // Already running terminals keep their old profile.
  expect(root.querySelector('[data-automation-id=session-directory]')?.textContent).toBe('$SHELL');
  fireEvent.tap(root.querySelector('[data-automation-id=close-settings]')!);
  fireEvent.tap(root.querySelector('[data-automation-id=new-tab]')!);
  await rstest.waitFor(() =>
    expect(
      (NativeModules.nodejs.exposed as TerminalHost).createTerminalSession,
    ).toHaveBeenCalledTimes(2),
  );
  const calls = rstest.mocked((NativeModules.nodejs.exposed as TerminalHost).createTerminalSession)
    .mock.calls;
  expect(calls[0]![3]).toBe('shell');
  expect(calls[1]![3]).toBe('tmux');
});

test('a new host chooses SSH, validates its host and previews the command', async () => {
  const host = makeHost();
  renderApp(host);
  const root = elementTree.root!;
  await waitForTerminal();
  await openSettings(root);
  fireEvent.tap(root.querySelector('[data-automation-id=add-workspace]')!);
  fireEvent.tap(root.querySelector('[data-automation-id=workspace-type-ssh]')!);
  await rstest.waitFor(() =>
    expect(root.querySelector('[data-automation-id=profile-host]')).not.toBeNull(),
  );
  fireEvent.tap(root.querySelector('[data-automation-id=profile-default-tab-tmux]')!);
  fireEvent.tap(root.querySelector('[data-automation-id=save-workspace]')!);
  expect(host.saveWorkspaces).not.toHaveBeenCalled();
  await rstest.waitFor(() =>
    expect(root.querySelector('[data-automation-id=editor-error]')).not.toBeNull(),
  );
  await changeInput(root, '[data-automation-id=profile-host]', 'user@server');
  await changeInput(root, '[data-automation-id=profile-remoteCommand]', 'cd /srv && exec bash -l');
  expect(root.querySelector('[data-automation-id=ssh-command-preview]')?.textContent).toContain(
    "'ssh' '-tt' '--' 'user@server'",
  );
  expect(root.querySelector('[data-automation-id=ssh-command-preview]')?.textContent).toContain(
    'tmux',
  );
  expect(
    root.querySelector('[data-automation-id=profile-default-tab-sftp]')?.className,
  ).not.toContain('opacity-50');
  fireEvent.tap(root.querySelector('[data-automation-id=save-workspace]')!);
  await rstest.waitFor(() => expect(host.saveWorkspaces).toHaveBeenCalledOnce());
  const saved = rstest.mocked(host.saveWorkspaces).mock.calls[0]![0].workspaces;
  expect(saved.at(-1)).toMatchObject({
    type: 'ssh',
    host: 'user@server',
    remoteCommand: 'cd /srv && exec bash -l',
    defaultTab: 'tmux',
  });
});

test('adding a workspace leaves it stopped until activated, and removing it closes its tabs', async () => {
  const host = makeHost();
  renderApp(host);
  const root = elementTree.root!;
  const { findByText } = getQueriesForElement(root);
  await waitForTerminal();
  await openSettings(root);
  fireEvent.tap(root.querySelector('[data-automation-id=add-workspace]')!);
  fireEvent.tap(root.querySelector('[data-automation-id=save-workspace]')!);
  await rstest.waitFor(() =>
    expect(root.querySelector('[data-automation-id=workspace-workspace-1]')).not.toBeNull(),
  );
  expect(root.querySelector('[data-automation-id=running-workspace-1]')).toBeNull();
  fireEvent.tap(root.querySelector('[data-automation-id=close-settings]')!);
  fireEvent.tap(root.querySelector('[data-automation-id=workspace-workspace-1]')!);
  await findByText('New workspace 2');
  expect(root.querySelector('[data-automation-id=running-workspace-1]')).not.toBeNull();
  await openSettings(root);
  hoverHost('workspace-1', true);
  await rstest.waitFor(() =>
    expect(root.querySelector('[data-automation-id=delete-host-workspace-1]')).not.toBeNull(),
  );
  fireEvent.tap(root.querySelector('[data-automation-id=delete-host-workspace-1]')!);
  await rstest.waitFor(() =>
    expect(root.querySelector('[data-automation-id=confirm-delete-host]')).not.toBeNull(),
  );
  fireEvent.tap(root.querySelector('[data-automation-id=confirm-delete-host]')!);
  await rstest.waitFor(() =>
    expect(root.querySelector('[data-automation-id=workspace-workspace-1]')).toBeNull(),
  );
  expect(root.querySelector('[data-automation-id=tab-2]')).toBeNull();
  expect(rstest.mocked(host.saveWorkspaces).mock.calls[1]![0].workspaces).toHaveLength(
    defaults.workspaces.length,
  );
  expect(root.querySelector('[data-automation-id=settings-host-workspace-1]')).toBeNull();
});

test('Hook Form shows Schema field errors, revalidates corrections and resets on reopening', async () => {
  const host = makeHost();
  renderApp(host);
  const root = elementTree.root!;
  await waitForTerminal();
  await openEditor(root);
  await changeInput(root, '[data-automation-id=profile-name]', ' ');
  await changeInput(root, '[data-automation-id=profile-cwd]', ' ');
  await changeInput(root, '[data-automation-id=profile-color]', '#xyz');
  fireEvent.tap(root.querySelector('[data-automation-id=save-workspace]')!);
  await rstest.waitFor(() =>
    expect(root.querySelector('[data-automation-id=workspace-editor-form]')?.textContent).toContain(
      'Use a six-digit hex color',
    ),
  );
  expect(root.querySelector('[data-automation-id=workspace-editor-form]')?.textContent).toContain(
    'Required',
  );
  expect(host.saveWorkspaces).not.toHaveBeenCalled();
  await changeInput(root, '[data-automation-id=profile-name]', ' Updated shell ');
  await changeInput(root, '[data-automation-id=profile-cwd]', ' ~/work ');
  await changeInput(root, '[data-automation-id=profile-color]', '#aabbcc');
  await rstest.waitFor(() =>
    expect(root.querySelector('[data-automation-id=editor-error]')).toBeNull(),
  );
  fireEvent.tap(root.querySelector('[data-automation-id=save-workspace]')!);
  await rstest.waitFor(() => expect(host.saveWorkspaces).toHaveBeenCalledOnce());
  expect(rstest.mocked(host.saveWorkspaces).mock.calls[0]![0].workspaces[0]).toMatchObject({
    name: 'Updated shell',
    cwd: '~/work',
    color: '#aabbcc',
    defaultTab: 'shell',
    args: ['-l'],
  });
  await openEditor(root);
  expect(root.querySelector('[data-automation-id=editor-error]')).toBeNull();
  expect((root.querySelector('[data-automation-id=profile-name]') as HTMLInputElement).value).toBe(
    'Updated shell',
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
    Number(
      elementTree
        .root!.querySelector('[data-automation-id=terminal-surface]')!
        .getAttribute('terminal-id'),
    ),
  ).toBe(id);
  act(() => closeTab(sessionRegistry, id));
  expect(host.closeTerminalSession).toHaveBeenCalledOnce();
  expect(host.closeTerminalSession).toHaveBeenCalledWith(id);
});

test('terminal leaves keyboard handling to the native input client', async () => {
  renderApp();
  await waitForTerminal();
  const query = lynx.createSelectorQuery() as unknown as { selectUniqueID(id: number): object };
  const invoke = rstest.spyOn(Object.getPrototypeOf(query.selectUniqueID(0)), 'invoke');
  invoke.mockClear();
  const surface = elementTree.root!.querySelector('[data-automation-id=terminal-surface]')!;
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
  key(true);
  expect(invoke).not.toHaveBeenCalled();
});

test('SSH has separate terminal and SFTP buttons; directory navigation preserves the native view', async () => {
  const upload = rstest.spyOn(sftpClient, 'uploadFiles').mockResolvedValue(true);
  const download = rstest.spyOn(sftpClient, 'downloadFile').mockResolvedValue(false);
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
  const surface = root.querySelector('[data-automation-id=terminal-surface]');
  expect(root.querySelector('[data-automation-id=new-sftp-tab]')).not.toBeNull();
  expect(root.querySelector('[data-automation-id=new-sftp-tab] svg')).not.toBeNull();
  const list = () =>
    root.querySelector('[data-automation-id=sftp-list]')! as Parameters<
      typeof elementTree.enterListItemAtIndex
    >[0];
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
  fireEvent.tap(root.querySelector('[data-automation-id=new-sftp-tab]')!);
  await rstest.waitFor(() => expect(visibleText(1)).toContain('docs'));
  expect(root.querySelector('[data-automation-id=sftp-path]')?.textContent).toBe(
    '…›users›home›test',
  );
  expect(visibleText(1)).not.toContain('.env');
  expect(root.querySelector('[data-automation-id=session-label]')).toBeNull();
  expect(root.querySelector('[data-automation-id=session-directory]')).toBeNull();
  expect(visibleText(1)).not.toContain('.cache');
  fireEvent.tap(root.querySelector('[data-automation-id=sftp-show-hidden]')!);
  await rstest.waitFor(() => expect(visibleText(3)).toContain('.cache'));
  expect(visibleText(3)).toContain('.env');
  const fileRow = elementTree.__GetElementByUniqueId(visibleCells[2]!)!;
  expect(fileRow.querySelector('[data-automation-id=sftp-download-2] svg')).not.toBeNull();
  fireEvent.tap(fileRow.querySelector('[data-automation-id=sftp-download-2]')!, {
    eventType: 'catchEvent',
    bubbles: true,
  });
  await rstest.waitFor(() =>
    expect(download).toHaveBeenCalledWith('test-alias', '/srv/users/home/test/.env'),
  );
  expect(
    fileRow.querySelector('[data-automation-id=sftp-entry-2]')?.getAttribute('class'),
  ).not.toContain('bg-[#35483f]');
  fireEvent.tap(root.querySelector('[data-automation-id=sftp-show-hidden]')!);
  await rstest.waitFor(() => expect(visibleText(1)).not.toContain('.cache'));
  expect(visibleText(1)).not.toContain('.env');
  expect(terminal.createTerminalSession).toHaveBeenCalledOnce();
  expect(Number(surface!.getAttribute('terminal-id'))).toBe(0);
  fireEvent.tap(
    elementTree
      .__GetElementByUniqueId(visibleCells[0]!)!
      .querySelector('[data-automation-id=sftp-entry-0]')!,
  );
  await rstest.waitFor(() => {
    visibleText(1);
    expect(
      elementTree
        .__GetElementByUniqueId(visibleCells[0]!)!
        .querySelector('[data-automation-id=sftp-empty]'),
    ).not.toBeNull();
  });
  expect(fs.readdir).toHaveBeenLastCalledWith('/srv/users/home/test/docs', { withFileTypes: true });
  fireEvent.tap(root.querySelector('[data-automation-id=sftp-up]')!);
  await rstest.waitFor(() => expect(visibleText(1)).toContain('docs'));
  fireEvent.tap(root.querySelector('[data-automation-id=sftp-breadcrumb-0]')!);
  await rstest.waitFor(() =>
    expect(fs.readdir).toHaveBeenLastCalledWith('/srv/users', { withFileTypes: true }),
  );
  expect(root.querySelector('[data-automation-id=sftp-breadcrumb-ellipsis]')).toBeNull();
  expect(root.querySelector('[data-automation-id=sftp-breadcrumb-current]')?.textContent).toBe(
    'users',
  );
  const reads = fs.readdir.mock.calls.length;
  fireEvent.tap(root.querySelector('[data-automation-id=sftp-upload]')!);
  await rstest.waitFor(() => expect(fs.readdir.mock.calls.length).toBeGreaterThan(reads));
  expect(upload).toHaveBeenCalledWith('test-alias', '/srv/users');
  fireEvent.tap(root.querySelector('[data-automation-id=tab-1]')!);
  expect(root.querySelector('[data-automation-id=terminal-surface]')).toBe(surface);
  expect(Number(surface!.getAttribute('terminal-id'))).toBe(1);
  expect(fs.close).not.toHaveBeenCalled();
  fireEvent.tap(root.querySelector('[data-automation-id=tab-2]')!);
  fireEvent.tap(root.querySelector('[data-automation-id=close-tab-2]')!, {
    eventType: 'catchEvent',
    bubbles: true,
  });
  await rstest.waitFor(() => expect(fs.close).toHaveBeenCalledOnce());
  expect(terminal.closeTerminalSession).not.toHaveBeenCalled();
});

test('shell Select loads candidates and saves local and remote shell choices', async () => {
  const host = makeHost();
  renderApp(host);
  await waitForTerminal();
  const root = elementTree.root!;
  await openEditor(root);
  await rstest.waitFor(() => expect(host.listShells).toHaveBeenCalledWith(undefined));
  expect(root.querySelector('[data-automation-id=profile-command]')).toBeNull();
  fireEvent.tap(root.querySelector('[data-automation-id=profile-shell]')!);
  await rstest.waitFor(() =>
    expect(root.querySelector('[data-automation-id=profile-shell-option-1]')).not.toBeNull(),
  );
  fireEvent.tap(root.querySelector('[data-automation-id=profile-shell-option-1]')!);
  fireEvent.tap(root.querySelector('[data-automation-id=save-workspace]')!);
  await rstest.waitFor(() => expect(host.saveWorkspaces).toHaveBeenCalledOnce());
  expect(rstest.mocked(host.saveWorkspaces).mock.calls[0]![0].workspaces[0]).toMatchObject({
    shell: '/bin/zsh',
    command: '/bin/zsh',
    args: ['-l'],
  });
  // Saving keeps the settings dialog open on the same host.
  expect(root.querySelector('[data-automation-id=profile-shell]')).not.toBeNull();

  // Remote candidates need a new SSH host; the type of a saved host is fixed.
  fireEvent.tap(root.querySelector('[data-automation-id=add-workspace]')!);
  fireEvent.tap(root.querySelector('[data-automation-id=workspace-type-ssh]')!);
  await changeInput(root, '[data-automation-id=profile-host]', 'remote-alias');
  await rstest.waitFor(() => expect(host.listShells).toHaveBeenCalledWith('remote-alias'));
  expect(root.querySelector('[data-automation-id=ssh-command-preview]')?.textContent).toContain(
    "'ssh' '-t' '--' 'remote-alias'",
  );
  fireEvent.tap(root.querySelector('[data-automation-id=profile-shell]')!);
  await rstest.waitFor(() =>
    expect(root.querySelector('[data-automation-id=profile-shell-option-custom]')).not.toBeNull(),
  );
  fireEvent.tap(root.querySelector('[data-automation-id=profile-shell-option-custom]')!);
  await changeInput(root, '[data-automation-id=profile-command]', 'exec fish');
  fireEvent.tap(root.querySelector('[data-automation-id=save-workspace]')!);
  await rstest.waitFor(() => expect(host.saveWorkspaces).toHaveBeenCalledTimes(2));
  expect(rstest.mocked(host.saveWorkspaces).mock.calls[1]![0].workspaces.at(-1)).toMatchObject({
    type: 'ssh',
    host: 'remote-alias',
    shell: 'custom',
    command: 'exec fish',
  });
});

test('settings edits an inactive workspace without starting it; failed deletion can retry', async () => {
  const host = makeHost();
  renderApp(host);
  await waitForTerminal();
  const root = elementTree.root!;
  const terminal = NativeModules.nodejs.exposed as TerminalHost;
  await openEditor(root, 'local');
  expect((root.querySelector('[data-automation-id=profile-name]') as HTMLInputElement).value).toBe(
    'Local',
  );
  expect(terminal.createTerminalSession).toHaveBeenCalledOnce();
  expect(sessionRegistry.get(activeWorkspaceIdAtom)).toBe('shell');
  fireEvent.tap(root.querySelector('[data-automation-id=close-settings]')!);
  fireEvent.tap(root.querySelector('[data-automation-id=workspace-local]')!);
  await rstest.waitFor(() => expect(terminal.createTerminalSession).toHaveBeenCalledTimes(2));
  fireEvent.tap(root.querySelector('[data-automation-id=workspace-shell]')!);
  await rstest.waitFor(() => expect(sessionRegistry.get(activeWorkspaceIdAtom)).toBe('shell'));

  // Deleting the displayed host keeps its draft until persistence succeeds.
  await openSettings(root);
  fireEvent.tap(root.querySelector('[data-automation-id=settings-host-local]')!);
  await rstest.waitFor(() =>
    expect(
      (root.querySelector('[data-automation-id=profile-name]') as HTMLInputElement).value,
    ).toBe('Local'),
  );
  hoverHost('local', true);
  await rstest.waitFor(() =>
    expect(root.querySelector('[data-automation-id=delete-host-local]')).not.toBeNull(),
  );
  rstest.mocked(host.saveWorkspaces).mockRejectedValueOnce(new Error('Permission denied'));
  fireEvent.tap(root.querySelector('[data-automation-id=delete-host-local]')!);
  await rstest.waitFor(() =>
    expect(root.querySelector('[data-automation-id=confirm-delete-host]')).not.toBeNull(),
  );
  fireEvent.tap(root.querySelector('[data-automation-id=confirm-delete-host]')!);
  await rstest.waitFor(() =>
    expect(root.querySelector('[data-automation-id=editor-error]')?.textContent).toContain(
      'Permission denied',
    ),
  );
  expect(root.querySelector('[data-automation-id=workspace-local]')).not.toBeNull();
  expect(terminal.closeTerminalSession).not.toHaveBeenCalled();
  hoverHost('local', true);
  await rstest.waitFor(() =>
    expect(root.querySelector('[data-automation-id=delete-host-local]')).not.toBeNull(),
  );
  fireEvent.tap(root.querySelector('[data-automation-id=delete-host-local]')!);
  await rstest.waitFor(() =>
    expect(root.querySelector('[data-automation-id=confirm-delete-host]')).not.toBeNull(),
  );
  fireEvent.tap(root.querySelector('[data-automation-id=confirm-delete-host]')!);
  await rstest.waitFor(() =>
    expect(root.querySelector('[data-automation-id=workspace-local]')).toBeNull(),
  );
  expect(terminal.closeTerminalSession).toHaveBeenCalledExactlyOnceWith(2);
  expect(sessionRegistry.get(activeWorkspaceIdAtom)).toBe('shell');
});

function hoverWorkspace(id: string, enter: boolean) {
  const trigger = elementTree.root!.querySelector(`[data-automation-id=workspace-${id}]`)!;
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
  expect(root.querySelector('[data-automation-id=workspace-local]')?.textContent).not.toContain(
    'Local',
  );
  hoverWorkspace('local', true);
  await rstest.waitFor(() =>
    expect(
      root.querySelector('[data-automation-id=workspace-details-local]')?.textContent,
    ).toContain('Local'),
  );
  expect(root.querySelector('[data-automation-id=workspace-details-local]')?.textContent).toContain(
    'Working directory',
  );
  expect(sessionRegistry.get(activeWorkspaceIdAtom)).toBe('shell');
  expect(terminal.createTerminalSession).toHaveBeenCalledOnce();
  hoverWorkspace('local', false);
  await rstest.waitFor(() =>
    expect(root.querySelector('[data-automation-id=workspace-details-local]')).toBeNull(),
  );
  hoverWorkspace('local', true);
  await rstest.waitFor(() =>
    expect(root.querySelector('[data-automation-id=workspace-details-local]')).not.toBeNull(),
  );
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
  expect(root.querySelector('[data-automation-id=workspace-details-local]')).toBeNull();
  act(() => responses[1]!({ left: 8, top: 100, width: 40, height: 40 }));
  await rstest.waitFor(() =>
    expect(root.querySelector('[data-automation-id=workspace-details-local]')).not.toBeNull(),
  );
  const details = root.querySelector('[data-automation-id=workspace-details-local]')!;
  expect(details.className).toContain('pointer-events-none');
  expect(details.getAttribute('event-through')).toBe('true');
  hoverWorkspace('local', false);
  await rstest.waitFor(() =>
    expect(root.querySelector('[data-automation-id=workspace-details-local]')).toBeNull(),
  );
});

test('leaving hover preserves styles during the delay and then removes the content', async () => {
  renderApp();
  await waitForTerminal();
  const root = elementTree.root!;
  for (let count = 0; count < 3; count++) {
    hoverWorkspace('local', true);
    await rstest.waitFor(() =>
      expect(root.querySelector('[data-automation-id=workspace-details-local]')).not.toBeNull(),
    );
    const details = root.querySelector('[data-automation-id=workspace-details-local]')!;
    const classes = details.className;
    expect(classes).toContain('bg-[#20262d]');
    hoverWorkspace('local', false);
    expect(root.querySelector('[data-automation-id=workspace-details-local]')).toBe(details);
    expect(details.className).toBe(classes);
    await rstest.waitFor(() =>
      expect(root.querySelector('[data-automation-id=workspace-details-local]')).toBeNull(),
    );
    expect(details.className).toBe(classes);
  }
});

function hoverHost(id: string, enter: boolean) {
  const eventName = enter ? 'mouseenter' : 'mouseleave';
  fireEvent(
    elementTree.root!.querySelector(`[data-automation-id=settings-host-${id}]`)!.parentElement!,
    Object.assign(new Event(`bindEvent:${eventName}`), { eventType: 'bindEvent', eventName }),
  );
}

test('settings opens from the sidebar with host and display sections', async () => {
  const host = makeHost();
  renderApp(host);
  await waitForTerminal();
  const root = elementTree.root!;
  await openSettings(root);
  expect(root.querySelector('[data-automation-id=settings-host-shell]')).not.toBeNull();
  expect(root.querySelector('[data-automation-id=profile-tmuxPrefix]')).not.toBeNull();
  fireEvent.tap(root.querySelector('[data-automation-id=settings-nav-display]')!);
  await rstest.waitFor(() =>
    expect(root.querySelector('[data-automation-id=settings-language]')).not.toBeNull(),
  );
  expect(root.querySelector('[data-automation-id=profile-tmuxPrefix]')).toBeNull();
  fireEvent.tap(root.querySelector('[data-automation-id=settings-language]')!);
  await rstest.waitFor(() =>
    expect(root.querySelector('[data-automation-id=settings-language-en]')).not.toBeNull(),
  );
  fireEvent.tap(root.querySelector('[data-automation-id=settings-nav-hosts]')!);
  await rstest.waitFor(() =>
    expect(root.querySelector('[data-automation-id=profile-tmuxPrefix]')).not.toBeNull(),
  );
  fireEvent.tap(root.querySelector('[data-automation-id=close-settings]')!);
  await rstest.waitFor(() =>
    expect(root.querySelector('[data-automation-id=settings-dialog]')).toBeNull(),
  );
});

test('deleting a host requires the confirmation popover', async () => {
  const host = makeHost();
  renderApp(host);
  await waitForTerminal();
  const root = elementTree.root!;
  await openSettings(root);
  hoverHost('local', true);
  await rstest.waitFor(() =>
    expect(root.querySelector('[data-automation-id=delete-host-local]')).not.toBeNull(),
  );
  fireEvent.tap(root.querySelector('[data-automation-id=delete-host-local]')!);
  await rstest.waitFor(() =>
    expect(root.querySelector('[data-automation-id=delete-host-popover]')).not.toBeNull(),
  );
  expect(host.saveWorkspaces).not.toHaveBeenCalled();
  fireEvent.tap(root.querySelector('[data-automation-id=cancel-delete-host]')!);
  await rstest.waitFor(() =>
    expect(root.querySelector('[data-automation-id=delete-host-popover]')).toBeNull(),
  );
  expect(host.saveWorkspaces).not.toHaveBeenCalled();
  expect(root.querySelector('[data-automation-id=settings-host-local]')).not.toBeNull();

  fireEvent.tap(root.querySelector('[data-automation-id=delete-host-local]')!);
  await rstest.waitFor(() =>
    expect(root.querySelector('[data-automation-id=confirm-delete-host]')).not.toBeNull(),
  );
  fireEvent.tap(root.querySelector('[data-automation-id=confirm-delete-host]')!);
  await rstest.waitFor(() => expect(host.saveWorkspaces).toHaveBeenCalledOnce());
  expect(root.querySelector('[data-automation-id=settings-host-local]')).toBeNull();
  expect(root.querySelector('[data-automation-id=settings-host-shell]')).not.toBeNull();
});

test('the tmux prefix is edited with the host and saved', async () => {
  const host = makeHost();
  renderApp(host);
  await waitForTerminal();
  const root = elementTree.root!;
  await openSettings(root);
  expect(
    (root.querySelector('[data-automation-id=profile-tmuxPrefix]') as HTMLInputElement).value,
  ).toBe('catus-');
  await changeInput(root, '[data-automation-id=profile-tmuxPrefix]', 'dev-');
  fireEvent.tap(root.querySelector('[data-automation-id=save-workspace]')!);
  await rstest.waitFor(() => expect(host.saveWorkspaces).toHaveBeenCalledOnce());
  expect(
    rstest
      .mocked(host.saveWorkspaces)
      .mock.calls[0]![0].workspaces.find((item) => item.id === 'shell')?.tmuxPrefix,
  ).toBe('dev-');
});

test('reopening settings restores shell detection for the retained host', async () => {
  const host = makeHost();
  renderApp(host);
  await waitForTerminal();
  const root = elementTree.root!;
  await openSettings(root);
  await rstest.waitFor(() => expect(host.listShells).toHaveBeenCalledTimes(1));
  fireEvent.tap(root.querySelector('[data-automation-id=close-settings]')!);
  await rstest.waitFor(() =>
    expect(root.querySelector('[data-automation-id=settings-dialog]')).toBeNull(),
  );
  await openSettings(root);
  await rstest.waitFor(() => expect(host.listShells).toHaveBeenCalledTimes(2));
  expect(root.querySelector('[data-automation-id=profile-shell]')).not.toBeNull();
});

test('deleting the displayed host keeps saving disabled and selects a replacement', async () => {
  const payload = {
    config: parseWorkspaceConfig(defaults),
    path: '/tmp/catus/workspaces.json',
    environment: { shell: '/bin/zsh', home: '/Users/test' },
  };
  let finish: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const host: WorkspaceHost = {
    listShells: rstest.fn(async () => [{ value: '/bin/zsh', label: 'zsh · /bin/zsh' }]),
    loadWorkspaces: rstest.fn(async () => payload),
    saveWorkspaces: rstest.fn(async (config: WorkspaceConfig) => {
      await pending;
      return { ...payload, config };
    }),
  };
  renderApp(host);
  await waitForTerminal();
  const root = elementTree.root!;
  await openSettings(root);
  fireEvent.tap(root.querySelector('[data-automation-id=settings-host-local]')!);
  await rstest.waitFor(() =>
    expect(
      (root.querySelector('[data-automation-id=profile-name]') as HTMLInputElement).value,
    ).toBe('Local'),
  );
  hoverHost('local', true);
  fireEvent.tap(root.querySelector('[data-automation-id=delete-host-local]')!);
  await rstest.waitFor(() =>
    expect(root.querySelector('[data-automation-id=confirm-delete-host]')).not.toBeNull(),
  );
  fireEvent.tap(root.querySelector('[data-automation-id=confirm-delete-host]')!);
  await rstest.waitFor(() => expect(host.saveWorkspaces).toHaveBeenCalledOnce());
  // While persistence is in flight the deleted draft stays selected and disabled.
  expect(root.querySelector('[data-automation-id=save-workspace]')?.textContent).toContain(
    'Saving',
  );
  expect((root.querySelector('[data-automation-id=profile-name]') as HTMLInputElement).value).toBe(
    'Local',
  );
  finish();
  await rstest.waitFor(() =>
    expect(root.querySelector('[data-automation-id=settings-host-local]')).toBeNull(),
  );
  await rstest.waitFor(() =>
    expect(
      (root.querySelector('[data-automation-id=profile-name]') as HTMLInputElement).value,
    ).toBe('Shell'),
  );
});
