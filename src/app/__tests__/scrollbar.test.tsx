import { expect, test, rstest } from '@rstest/core';
import { act, render } from '@lynx-js/react/testing-library';
import { ScrollBar } from '../components/ui/ScrollBar';
import { TerminalView } from '../components/Terminal/TerminalView';
import { scrollbarGeometry, scrollbarOffset } from '../components/ui/scrollbarGeometry';

async function send(target: Element, event: Event) {
  await act(async () => {
    target.dispatchEvent(event);
  });
}

test('scrollbar geometry clamps endpoints and keeps a draggable minimum thumb', () => {
  expect(scrollbarGeometry(100, 20, 80, 0)).toEqual({ thumb: 24, travel: 76, top: 76 });
  expect(scrollbarGeometry(100, 20, 80, 80).top).toBe(0);
  expect(scrollbarGeometry(10, 20, 80, 0).travel).toBe(0);
  expect(scrollbarOffset(-50, 76, 80)).toBe(80);
  expect(scrollbarOffset(100, 76, 80)).toBe(0);
  expect(scrollbarOffset(38, 76, 80)).toBe(40);
});

test('mouse dragging continues outside the thumb and stops on release', async () => {
  const callback = rstest.fn();
  const query = lynx.createSelectorQuery() as unknown as { selectUniqueID(id: number): object };
  rstest
    .spyOn(Object.getPrototypeOf(query.selectUniqueID(0)), 'invoke')
    .mockImplementation((argument: unknown) => {
      const options = argument as { success?(value: unknown): void };
      return { exec: () => options.success?.({ top: 0, height: 100 }) };
    });
  render(
    <ScrollBar id="bar" offset={0} historyRows={80} visibleRows={20} onOffsetChange={callback} />,
  );
  const root = elementTree.root!;
  const bar = root.querySelector('#bar')!;
  const thumb = root.querySelector('#bar-thumb')!;
  await send(
    thumb,
    Object.assign(new CustomEvent('catchEvent:mousedown'), { pageY: 88, buttons: 1 }),
  );
  await send(
    bar,
    Object.assign(new CustomEvent('global-bindEvent:mousemove'), { pageY: 50, buttons: 1 }),
  );
  expect(callback).toHaveBeenLastCalledWith(40);
  await send(
    bar,
    Object.assign(new CustomEvent('global-bindEvent:mouseup'), { pageY: 50, buttons: 0 }),
  );
  const calls = callback.mock.calls.length;
  await send(
    bar,
    Object.assign(new CustomEvent('global-bindEvent:mousemove'), { pageY: 0, buttons: 1 }),
  );
  expect(callback.mock.calls).toHaveLength(calls);
});

test('terminal ignores stale native scroll events when switching sessions', async () => {
  render(<TerminalView id={1} sessionId={1} error="" />);
  const root = elementTree.root!;
  const native = root.querySelector('#terminal-surface')!;
  await send(
    native,
    new CustomEvent('bindEvent:scrollchange', {
      detail: { sessionId: 1, offset: 8, historyRows: 20, visibleRows: 3 },
    }),
  );
  expect(root.querySelector('#terminal-scrollbar')?.getAttribute('data-offset')).toBe('8');
  await send(
    native,
    new CustomEvent('bindEvent:scrollchange', {
      detail: { sessionId: 2, offset: 0, historyRows: 0, visibleRows: 3 },
    }),
  );
  expect(root.querySelector('#terminal-scrollbar')?.getAttribute('data-offset')).toBe('8');
});
