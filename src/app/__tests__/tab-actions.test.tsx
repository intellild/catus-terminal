import { expect, rstest, test } from '@rstest/core';
import { fireEvent, render } from '@lynx-js/react/testing-library';
import { TabActions } from '../components/tab-bar/tab-actions';

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

function tmuxActions(sessions = [{ name: 'catus-0', windows: 2, attached: 1, activity: 10 }]) {
  const handlers = {
    onOpen: rstest.fn(),
    onAttach: rstest.fn(),
    onNew: rstest.fn(),
    onClose: rstest.fn(),
  };
  render(
    <TabActions
      ssh
      defaultKind="shell"
      onAdd={() => {}}
      tmux={{
        sessions,
        onOpen: handlers.onOpen,
        onAttach: handlers.onAttach,
        onNew: handlers.onNew,
        onClose: handlers.onClose,
      }}
    />,
    { enableMainThread: true },
  );
  return handlers;
}

function rightClick(id: string) {
  fireEvent(
    elementTree.root!.querySelector(`[data-automation-id=${id}]`)!,
    Object.assign(new CustomEvent('bindEvent:mousedown'), {
      button: 2,
      buttons: 2,
      pageX: 40,
      pageY: 20,
    }),
  );
}
function hover(id: string, enter: boolean) {
  const eventName = enter ? 'mouseenter' : 'mouseleave';
  fireEvent(
    elementTree.root!.querySelector(`[data-automation-id=${id}]`)!,
    Object.assign(new Event(`bindEvent:${eventName}`), { eventType: 'bindEvent', eventName }),
  );
}

test('the tmux tab action badges the session count and opens the attach menu on right click', async () => {
  const handlers = tmuxActions();
  const root = elementTree.root!;
  expect(root.querySelector('[data-automation-id=tmux-session-count]')?.textContent).toBe('1');
  rightClick('new-tmux-tab');
  await rstest.waitFor(() =>
    expect(root.querySelector('[data-automation-id=tmux-session-menu]')).not.toBeNull(),
  );
  expect(handlers.onOpen).toHaveBeenCalled();
  fireEvent.tap(root.querySelector('[data-automation-id=tmux-session-catus-0]')!);
  expect(handlers.onAttach).toHaveBeenCalledWith('catus-0');
  await rstest.waitFor(() =>
    expect(root.querySelector('[data-automation-id=tmux-session-menu]')).toBeNull(),
  );
});

test('each tmux session row reveals a close action on hover', async () => {
  const handlers = tmuxActions();
  const root = elementTree.root!;
  rightClick('new-tmux-tab');
  await rstest.waitFor(() =>
    expect(root.querySelector('[data-automation-id=tmux-session-menu]')).not.toBeNull(),
  );
  expect(root.querySelector('[data-automation-id=close-tmux-session-catus-0]')).toBeNull();
  hover('tmux-session-row-catus-0', true);
  await rstest.waitFor(() =>
    expect(root.querySelector('[data-automation-id=close-tmux-session-catus-0]')).not.toBeNull(),
  );
  fireEvent.tap(root.querySelector('[data-automation-id=close-tmux-session-catus-0]')!);
  expect(handlers.onClose).toHaveBeenCalledWith('catus-0');
  expect(handlers.onAttach).not.toHaveBeenCalled();
});

test('the tmux menu can start a new session and hides the badge when none exist', async () => {
  const handlers = tmuxActions([]);
  const root = elementTree.root!;
  expect(root.querySelector('[data-automation-id=tmux-session-count]')).toBeNull();
  rightClick('new-tmux-tab');
  await rstest.waitFor(() =>
    expect(root.querySelector('[data-automation-id=tmux-session-menu]')).not.toBeNull(),
  );
  fireEvent.tap(root.querySelector('[data-automation-id=tmux-new-session]')!);
  expect(handlers.onNew).toHaveBeenCalled();
});
