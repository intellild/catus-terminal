import { expect, test, rstest } from '@rstest/core';
import { fireEvent, render } from '@lynx-js/react/testing-library';
import { Button } from '../components/ui/Button';

function mouse(element: Element, type: 'mouseenter' | 'mouseleave') {
  fireEvent(element, new CustomEvent(`bindEvent:${type}`));
}

test('Button renders text on the main thread and restores its style after hover', () => {
  const onTap = rstest.fn();
  const enter = rstest.fn();
  const leave = rstest.fn();
  render(
    <Button
      id="button"
      bindtap={onTap}
      bindmouseenter={enter}
      bindmouseleave={leave}
      className="w-[120px]"
      hoverClassName="bg-[#abcdef]"
    >
      Save
    </Button>,
    { enableMainThread: true },
  );
  const button = elementTree.root!.querySelector('#button')!;
  expect(button.querySelector('text')?.textContent).toBe('Save');
  const initial = button.getAttribute('class');
  mouse(button, 'mouseenter');
  expect(button.getAttribute('class')).toContain('bg-[#abcdef]');
  expect(button.getAttribute('class')).toContain('w-[120px]');
  expect(enter).toHaveBeenCalledOnce();
  fireEvent.tap(button);
  expect(onTap).toHaveBeenCalledOnce();
  mouse(button, 'mouseleave');
  expect(button.getAttribute('class')).toBe(initial);
  expect(leave).toHaveBeenCalledOnce();
});

test('disabled Button blocks taps and hover even when disabled while hovered', () => {
  const onTap = rstest.fn();
  const renderButton = (disabled: boolean) => (
    <Button id="button" variant="ghost" disabled={disabled} bindtap={onTap}>
      Delete
    </Button>
  );
  const { rerender } = render(renderButton(false), { enableMainThread: true });
  const button = elementTree.root!.querySelector('#button')!;
  mouse(button, 'mouseenter');
  expect(button.getAttribute('class')).toContain('bg-[#343d47]');
  rerender(renderButton(true));
  expect(button.getAttribute('class')).toContain('opacity-50');
  expect(button.getAttribute('class')).not.toContain('bg-[#343d47]');
  fireEvent.tap(button);
  mouse(button, 'mouseenter');
  expect(onTap).not.toHaveBeenCalled();
  expect(button.getAttribute('class')).not.toContain('bg-[#343d47]');
});
