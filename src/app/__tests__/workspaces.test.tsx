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
});

function makeHost() {
  const payload = { config: parseWorkspaceConfig(defaults), path: '/tmp/catus/workspaces.json', environment: { shell: '/bin/zsh', home: '/Users/test' } };
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
  for (const id of ['application-layout', 'window-tab-bar', 'window-controls-space', 'workspace-dock', 'terminal-content', 'application-status']) {
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
  await findByText('A little space to make things.');
  expect(root.querySelector('#session-command')?.textContent).toBe('/bin/zsh -l');
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
  expect(root.querySelector('#tab-2')).toBeNull();
  fireEvent.tap(root.querySelector('#workspace-node')!);
  await findByText('Node.js 3');
  fireEvent.tap(root.querySelector('#close-tab-3')!);
  fireEvent.tap(root.querySelector('#close-tab-2')!);
  await findByText('Start something new.');
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
  await findByText('A little space to make things.');
  fireEvent.tap(root.querySelector('#workspace-settings')!);
  await findByText('Launch profile');
  const input = root.querySelector('#profile-args')!;
  act(() => { input.dispatchEvent(new CustomEvent('bindEvent:input', { detail: { value: 'invalid' } })); });
  fireEvent.tap(root.querySelector('#save-workspace')!);
  expect(host.saveWorkspaces).not.toHaveBeenCalled();
  expect(root.querySelector('#editor-error')).not.toBeNull();
  act(() => { input.dispatchEvent(new CustomEvent('bindEvent:input', { detail: { value: '["-l", "-i"]' } })); });
  fireEvent.tap(root.querySelector('#save-workspace')!);
  await rstest.waitFor(() => expect(host.saveWorkspaces).toHaveBeenCalledOnce());
  expect(rstest.mocked(host.saveWorkspaces).mock.calls[0]![0].workspaces[0]!.args).toEqual(['-l', '-i']);
  // Existing tab keeps the launch profile it was opened with.
  expect(root.querySelector('#session-command')?.textContent).toBe('/bin/zsh -l');
});

test('adding a workspace leaves it stopped until activated, and removing it closes its tabs', async () => {
  const host = makeHost();
  render(<App host={host} />);
  const root = elementTree.root!;
  const { findByText } = getQueriesForElement(root);
  await findByText('A little space to make things.');
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
