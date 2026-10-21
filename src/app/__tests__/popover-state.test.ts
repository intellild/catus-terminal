import { afterEach, beforeEach, expect, rstest, test } from '@rstest/core';
import * as AtomRegistry from 'effect/reactivity/AtomRegistry';
import { makePopoverState } from '../components/ui/popover-state';
import type { MeasurePopover, PopoverOptions } from '../components/ui/popover-state';

let registry: AtomRegistry.AtomRegistry;
beforeEach(() => {
  rstest.useFakeTimers();
  registry = AtomRegistry.make();
});
afterEach(() => {
  registry.dispose();
  rstest.useRealTimers();
});
const measure: MeasurePopover = (isCurrent, done) => {
  if (isCurrent()) {
    done();
  }
};
function setup(options: () => PopoverOptions = () => ({}), defaultOpen = false) {
  const state = makePopoverState(defaultOpen, options);
  registry.mount(state.controllerAtom);
  return { ...state, controller: registry.get(state.controllerAtom) };
}

test('uncontrolled state and context coordinates work without React', () => {
  const { controller, openAtom, pointAtom } = setup();
  controller.click(measure);
  expect(registry.get(openAtom)).toBe(true);
  controller.click(measure);
  expect(registry.get(openAtom)).toBe(false);
  controller.trigger({ x: 10, y: 20 });
  expect(registry.get(openAtom)).toBe(true);
  expect(registry.get(pointAtom)).toEqual({ x: 10, y: 20 });
});

test('double click cancels an outstanding measurement; a late result cannot reopen', () => {
  const { controller, openAtom } = setup();
  let complete = () => {};
  controller.click((isCurrent, done) => {
    complete = () => {
      if (isCurrent()) {
        done();
      }
    };
  });
  controller.click(measure);
  complete();
  expect(registry.get(openAtom)).toBe(false);
});

test('hover uses Effect sleep, replaces close with enter and cancels on explicit close', () => {
  const { controller, openAtom } = setup();
  controller.enter(measure);
  rstest.advanceTimersByTime(99);
  expect(registry.get(openAtom)).toBe(false);
  rstest.advanceTimersByTime(1);
  expect(registry.get(openAtom)).toBe(true);
  controller.leave();
  rstest.advanceTimersByTime(50);
  controller.enter(measure);
  rstest.advanceTimersByTime(100);
  expect(registry.get(openAtom)).toBe(true);
  controller.setOpen(false);
  rstest.advanceTimersByTime(200);
  expect(registry.get(openAtom)).toBe(false);
});

test('programmatic changes invalidate pending hover measurement and sleep', () => {
  const { controller, openAtom } = setup();
  let complete = () => {};
  controller.enter((_, done) => {
    complete = done;
  });
  controller.setOpen(false);
  complete();
  rstest.advanceTimersByTime(100);
  expect(registry.get(openAtom)).toBe(false);
  controller.enter(measure);
  controller.setOpen(false);
  rstest.advanceTimersByTime(100);
  expect(registry.get(openAtom)).toBe(false);
});

test('controlled state reads the latest props and callback without changing internal state', () => {
  let options: PopoverOptions = { open: false, onOpenChange: rstest.fn() };
  const { controller, openAtom } = setup(() => options);
  controller.click(measure);
  expect(options.onOpenChange).toHaveBeenLastCalledWith(true);
  expect(registry.get(openAtom)).toBe(false);
  options = { open: true, onOpenChange: rstest.fn() };
  controller.click(measure);
  expect(options.onOpenChange).toHaveBeenLastCalledWith(false);
});

test.each(['reset', 'dispose'] as const)(
  'registry %s interrupts sleep and invalidates old controllers',
  (operation) => {
    const onOpenChange = rstest.fn();
    const { controller } = setup(() => ({ onOpenChange }));
    controller.enter(measure);
    registry[operation]();
    rstest.advanceTimersByTime(200);
    controller.setOpen(true);
    expect(onOpenChange).not.toHaveBeenCalled();
  },
);

test('registry reset rejects native measurement results arriving after cleanup', () => {
  const onOpenChange = rstest.fn();
  const { controller } = setup(() => ({ onOpenChange }));
  let complete = () => {};
  controller.click((_, done) => {
    complete = done;
  });
  registry.reset();
  complete();
  rstest.advanceTimersByTime(200);
  expect(onOpenChange).not.toHaveBeenCalled();
});

test('instances do not share state or delay tasks', () => {
  const first = setup();
  const second = setup();
  first.controller.enter(measure);
  second.controller.setOpen(true);
  first.controller.setOpen(false);
  rstest.advanceTimersByTime(200);
  expect(registry.get(first.openAtom)).toBe(false);
  expect(registry.get(second.openAtom)).toBe(true);
});
