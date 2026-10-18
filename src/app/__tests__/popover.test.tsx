import { afterEach, beforeEach, expect, rstest, test } from '@rstest/core';
import { act, fireEvent, render } from '@lynx-js/react/testing-library';
import * as PopoverDelay from '../components/ui/popoverDelay';
import {
  Popover,
  PopoverContent,
  PopoverAnchor,
  usePopover,
  usePopoverClickTrigger,
  usePopoverHoverTrigger,
} from '../components/ui/Popover';
import {
  ContextMenu,
  ContextMenuContent,
  useContextMenuTrigger,
} from '../components/ui/ContextMenu';

function Toggle() {
  const { open, setOpen } = usePopover();
  return <view data-automation-id="toggle-popover" bindtap={() => setOpen(!open)} />;
}

function ClickTrigger({ disabled }: { disabled?: boolean }) {
  const trigger = usePopoverClickTrigger({ disabled });
  return <view ref={trigger.ref} data-automation-id="click-trigger" bindtap={trigger.onTap} />;
}

function HoverTrigger({ delay }: { delay?: number }) {
  const trigger = usePopoverHoverTrigger({ delay });
  return (
    <view
      ref={trigger.ref}
      data-automation-id="hover-trigger"
      bindmouseenter={trigger.onMouseEnter}
      bindmouseleave={trigger.onMouseLeave}
    >
      <view data-automation-id="close-hover" bindtap={trigger.close} />
    </view>
  );
}

function Fixture({
  hover = false,
  delay,
  disabled,
  onOpenChange,
}: {
  hover?: boolean;
  delay?: number;
  disabled?: boolean;
  onOpenChange?(open: boolean): void;
}) {
  return (
    <Popover onOpenChange={onOpenChange}>
      <PopoverAnchor>
        <Toggle />
        {hover ? <HoverTrigger delay={delay} /> : <ClickTrigger disabled={disabled} />}
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
  const query = lynx.createSelectorQuery() as unknown as { selectUniqueID(id: number): object };
  rstest
    .spyOn(Object.getPrototypeOf(query.selectUniqueID(0)), 'invoke')
    .mockImplementation((argument: unknown) => {
      const options = argument as { success?(rect: object): void };
      return { exec: () => options.success?.({ left: 10, top: 20, width: 40, height: 30 }) };
    });
});
afterEach(() => {
  rstest.restoreAllMocks();
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
const hover = (enter: boolean) => {
  const eventName = enter ? 'mouseenter' : 'mouseleave';
  fireEvent(
    elementTree.root!.querySelector('[data-automation-id=hover-trigger]')!,
    Object.assign(new Event(`bindEvent:${eventName}`), { eventType: 'bindEvent', eventName }),
  );
};

test('click trigger opens and closes without scheduling a delay', () => {
  const onOpenChange = rstest.fn();
  const delay = rstest.spyOn(PopoverDelay, 'delayPopover');
  render(<Fixture onOpenChange={onOpenChange} />, { enableMainThread: true });
  const click = () =>
    fireEvent.tap(elementTree.root!.querySelector('[data-automation-id=click-trigger]')!);
  click();
  expect(contentCount()).toBe(1);
  expect(onOpenChange).toHaveBeenLastCalledWith(true);
  click();
  expect(contentCount()).toBe(0);
  expect(onOpenChange).toHaveBeenLastCalledWith(false);
  expect(delay).not.toHaveBeenCalled();
});

test('disabled click trigger does not open', () => {
  render(<Fixture disabled />, { enableMainThread: true });
  fireEvent.tap(elementTree.root!.querySelector('[data-automation-id=click-trigger]')!);
  expect(contentCount()).toBe(0);
});

test('programmatic visibility changes do not use the hover delay', () => {
  render(<Fixture hover />, { enableMainThread: true });
  toggle();
  expect(contentCount()).toBe(1);
  toggle();
  expect(contentCount()).toBe(0);
});

test.each([undefined, 40, 0, -1])(
  'hover trigger delays opening and closing with delay=%s',
  (delay) => {
    const onOpenChange = rstest.fn();
    render(<Fixture hover delay={delay} onOpenChange={onOpenChange} />, { enableMainThread: true });
    const duration = Math.max(0, delay ?? 100);
    hover(true);
    if (duration) {
      advance(duration - 1);
      expect(contentCount()).toBe(0);
      expect(onOpenChange).not.toHaveBeenCalled();
      advance(1);
    }
    expect(contentCount()).toBe(1);
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    hover(false);
    if (duration) {
      expect(contentCount()).toBe(1);
      advance(duration - 1);
      expect(contentCount()).toBe(1);
      advance(1);
    }
    expect(contentCount()).toBe(0);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  },
);

test('quickly leaving cancels opening; returning cancels closing', () => {
  render(<Fixture hover />, { enableMainThread: true });
  hover(true);
  advance(50);
  hover(false);
  advance(100);
  expect(contentCount()).toBe(0);
  hover(true);
  advance(100);
  expect(contentCount()).toBe(1);
  hover(false);
  advance(50);
  hover(true);
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
  const { unmount } = render(<Fixture hover />, { enableMainThread: true });
  hover(true);
  unmount();
  expect(cancel).toHaveBeenCalledOnce();
  advance(200);
  expect(callback).not.toHaveBeenCalled();
});

test('explicit hover close cancels pending opening and bypasses the close delay', () => {
  render(<Fixture hover />, { enableMainThread: true });
  const close = () =>
    fireEvent.tap(elementTree.root!.querySelector('[data-automation-id=close-hover]')!);
  hover(true);
  close();
  advance(100);
  expect(contentCount()).toBe(0);
  hover(true);
  advance(100);
  expect(contentCount()).toBe(1);
  close();
  expect(contentCount()).toBe(0);
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
  expect(elementTree.root!.querySelectorAll('cover-view')).toHaveLength(2);
  expect(
    elementTree.root!.querySelector('cover-view > [data-automation-id=test-popover-content]'),
  ).not.toBeNull();
  expect(elementTree.root!.querySelector('cover-view > .popover-dismiss')).not.toBeNull();
  fireEvent.tap(elementTree.root!.querySelector('.popover-dismiss')!);
  expect(contentCount()).toBe(0);
});

test.each([true, false])('content cover preserves event policy (interactive=%s)', (interactive) => {
  render(
    <Popover defaultOpen>
      <PopoverAnchor>
        <PopoverContent interactive={interactive} modal={false}>
          Details
        </PopoverContent>
      </PopoverAnchor>
    </Popover>,
    { enableMainThread: true },
  );
  const covers = elementTree.root!.querySelectorAll('cover-view');
  expect(covers).toHaveLength(1);
  expect(covers[0]!.getAttribute('events-pass-through')).toBe(String(!interactive));
});

test('right-click context menu opens and dismisses without a root delay', () => {
  function Trigger() {
    const trigger = useContextMenuTrigger();
    return <view data-automation-id="context-trigger" bindmousedown={trigger.onMouseDown} />;
  }
  render(
    <ContextMenu>
      <Trigger />
      <ContextMenuContent
        data-automation-id="test-popover-content"
        dismissClassName="context-dismiss"
      >
        Details
      </ContextMenuContent>
    </ContextMenu>,
    { enableMainThread: true },
  );
  fireEvent(
    elementTree.root!.querySelector('[data-automation-id=context-trigger]')!,
    Object.assign(new CustomEvent('bindEvent:mousedown'), {
      button: 2,
      buttons: 2,
      pageX: 10,
      pageY: 20,
    }),
  );
  expect(contentCount()).toBe(1);
  fireEvent.tap(elementTree.root!.querySelector('.context-dismiss')!);
  expect(contentCount()).toBe(0);
});
