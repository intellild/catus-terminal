import { expect, rstest, test } from '@rstest/core';
import { fireEvent, render } from '@lynx-js/react/testing-library';
import { TabActions } from '../components/TabBar';

function actions(ssh = true, defaultKind: 'shell' | 'tmux' | 'sftp' = 'shell') {
  const onAdd = rstest.fn();
  render(<TabActions defaultKind={defaultKind} ssh={ssh} onAdd={onAdd} />, {
    enableMainThread: true,
  });
  return onAdd;
}

test('tab actions keep the plus button for the workspace default kind', () => {
  const onAdd = actions();
  const root = elementTree.root!;
  for (const id of ['new-tab', 'new-tmux-tab', 'new-sftp-tab']) {
    expect(root.querySelector(`[data-automation-id=${id}]`)).not.toBeNull();
  }
  expect(root.querySelector('[data-automation-id=new-shell-tab]')).toBeNull();
  fireEvent.tap(root.querySelector('[data-automation-id=new-tab]')!);
  expect(onAdd).toHaveBeenLastCalledWith('shell');
  fireEvent.tap(root.querySelector('[data-automation-id=new-tmux-tab]')!);
  expect(onAdd).toHaveBeenLastCalledWith('tmux');
  fireEvent.tap(root.querySelector('[data-automation-id=new-sftp-tab]')!);
  expect(onAdd).toHaveBeenLastCalledWith('sftp');
});

test('tab actions expose the other two kinds and omit SFTP for local workspaces', () => {
  const tmux = actions(false, 'tmux');
  let root = elementTree.root!;
  expect(root.querySelector('[data-automation-id=new-shell-tab]')).not.toBeNull();
  expect(root.querySelector('[data-automation-id=new-sftp-tab]')).toBeNull();
  fireEvent.tap(root.querySelector('[data-automation-id=new-tab]')!);
  expect(tmux).toHaveBeenLastCalledWith('tmux');

  const sftp = actions(true, 'sftp');
  root = elementTree.root!;
  for (const id of ['new-tab', 'new-shell-tab', 'new-tmux-tab']) {
    expect(root.querySelector(`[data-automation-id=${id}]`)).not.toBeNull();
  }
  fireEvent.tap(root.querySelector('[data-automation-id=new-tab]')!);
  expect(sftp).toHaveBeenLastCalledWith('sftp');
});
