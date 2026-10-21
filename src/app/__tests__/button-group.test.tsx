import { expect, test, rstest } from '@rstest/core';
import { fireEvent, render } from '@lynx-js/react/testing-library';
import { Button } from '../components/ui/button';
import { ButtonGroup, ButtonGroupSeparator, ButtonGroupText } from '../components/ui/button-group';

test('ButtonGroup composes buttons, text and separators with orientation variants', () => {
  const onSave = rstest.fn();
  const onCancel = rstest.fn();
  render(
    <ButtonGroup
      data-automation-id="group"
      orientation="vertical"
      className="w-[180px]"
      accessibility-label="Actions"
    >
      <Button variant="secondary" bindtap={onSave}>
        Save
      </Button>
      <ButtonGroupSeparator orientation="horizontal" />
      <ButtonGroupText>or</ButtonGroupText>
      <Button variant="ghost" bindtap={onCancel}>
        Cancel
      </Button>
    </ButtonGroup>,
    { enableMainThread: true },
  );
  const group = elementTree.root!.querySelector('[data-automation-id=group]')!;
  expect(group.getAttribute('class')).toContain('flex-col');
  expect(group.getAttribute('class')).toContain('w-[180px]');
  expect(group.getAttribute('accessibility-label')).toBe('Actions');
  expect(group.querySelectorAll('text')).toHaveLength(3);
  fireEvent.tap(group.querySelectorAll('view')[0]!);
  expect(onSave).toHaveBeenCalledOnce();
  expect(onCancel).not.toHaveBeenCalled();
});

test('horizontal ButtonGroup defaults and text wrapping keep button taps independent', () => {
  const onClick = rstest.fn();
  render(
    <ButtonGroup data-automation-id="group">
      Text
      <Button data-automation-id="go" bindtap={onClick}>
        Go
      </Button>
    </ButtonGroup>,
    { enableMainThread: true },
  );
  const group = elementTree.root!.querySelector('[data-automation-id=group]')!;
  expect(group.getAttribute('class')).toContain('flex-row');
  expect(group.querySelector('text')?.textContent).toBe('Text');
  fireEvent.tap(group.querySelector('[data-automation-id=go]')!);
  expect(onClick).toHaveBeenCalledOnce();
});
