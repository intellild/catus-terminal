import { afterEach, beforeEach, expect, rstest, test } from '@rstest/core';
import { act, fireEvent, render } from '@lynx-js/react/testing-library';
import * as PopoverDelay from '../components/ui/popoverDelay';
import { Popover, PopoverContent, PopoverAnchor, usePopover } from '../components/ui/Popover';

function Toggle() {
  const { open, setOpen } = usePopover();
  return <view data-automation-id="toggle-popover" bindtap={() => setOpen(!open)} />;
}

function Fixture({ delay }: { delay?: number }) {
  return (
    <Popover delay={delay}>
      <PopoverAnchor>
        <Toggle />
        <PopoverContent data-automation-id="test-popover-content" modal={false}>
          Details
        </PopoverContent>
      </PopoverAnchor>
    </Popover>
  );
}

beforeEach(() => {
  rstest.useFakeTimers();
  Object.assign(lynx, { requestAnimationFrame: (callback: () => void) => setTimeout(callback, 0) });
});
afterEach(() => {
  rstest.useRealTimers();
});
const advance = (milliseconds: number) =>
  act(() => {
    rstest.advanceTimersByTime(milliseconds);
  });
const toggle = () =>
  fireEvent.tap(elementTree.root!.querySelector('[data-automation-id=toggle-popover]')!);
const contentCount = () =>
  elementTree.root!.querySelectorAll('[data-automation-id=test-popover-content]').length;

test.each([undefined, 40, 0])('popover delays opening and closing with delay=%s', (delay) => {
  render(<Fixture delay={delay} />, { enableMainThread: true });
  const duration = delay ?? 100;
  toggle();
  if (duration) {
    advance(duration - 1);
    expect(contentCount()).toBe(0);
    advance(1);
  }
  expect(contentCount()).toBe(1);
  toggle();
  if (duration) {
    expect(contentCount()).toBe(1);
    advance(duration - 1);
    expect(contentCount()).toBe(1);
    advance(1);
  }
  expect(contentCount()).toBe(0);
});

test('quickly leaving cancels opening; returning cancels closing', () => {
  render(<Fixture />, { enableMainThread: true });
  toggle();
  advance(50);
  toggle();
  advance(100);
  expect(contentCount()).toBe(0);
  toggle();
  advance(100);
  expect(contentCount()).toBe(1);
  toggle();
  advance(50);
  toggle();
  advance(100);
  expect(contentCount()).toBe(1);
});

test('unmount interrupts the pending Effect without running its callback', () => {
  const original = PopoverDelay.delayPopover;
  const callback = rstest.fn();
  const cancel = rstest.fn();
  rstest.spyOn(PopoverDelay, 'delayPopover').mockImplementation((milliseconds, onVisible) => {
    const interrupt = original(milliseconds, () => {
      callback();
      onVisible();
    });
    cancel.mockImplementation(interrupt);
    return cancel;
  });
  const { unmount } = render(<Fixture />, { enableMainThread: true });
  toggle();
  unmount();
  expect(cancel).toHaveBeenCalledOnce();
  advance(200);
  expect(callback).not.toHaveBeenCalled();
});

test('the Effect interruptor prevents the delayed callback from running', () => {
  const callback = rstest.fn();
  const cancel = PopoverDelay.delayPopover(100, callback);
  advance(50);
  cancel();
  advance(200);
  expect(callback).not.toHaveBeenCalled();
});

test('outside taps close a popover without waiting for Presence to enable its button', () => {
  function Modal() {
    return (
      <Popover>
        <PopoverAnchor>
          <Toggle />
          <PopoverContent
            data-automation-id="test-popover-content"
            dismissClassName="popover-dismiss"
          >
            Details
          </PopoverContent>
        </PopoverAnchor>
      </Popover>
    );
  }
  render(<Modal />, { enableMainThread: true });
  toggle();
  advance(100);
  fireEvent.tap(elementTree.root!.querySelector('.popover-dismiss')!);
  advance(100);
  expect(contentCount()).toBe(0);
});
