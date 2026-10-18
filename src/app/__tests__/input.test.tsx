import { afterEach, beforeEach, expect, rstest, test } from '@rstest/core';
import { act, fireEvent, render } from '@lynx-js/react/testing-library';
import type { ReactElement } from '@lynx-js/react';
import { Input, InputAfterAddon, InputBeforeAddon, InputGroup } from '../components/ui/Input';

const write = rstest.fn();

beforeEach(() => {
  write.mockClear();
  const query = lynx.createSelectorQuery() as unknown as { selectUniqueID(id: number): object };
  rstest
    .spyOn(Object.getPrototypeOf(query.selectUniqueID(0)), 'invoke')
    .mockImplementation((options: unknown) => ({ exec: () => write(options) }));
});

afterEach(() => {
  rstest.restoreAllMocks();
});

async function renderFixture(ui: ReactElement) {
  let result: ReturnType<typeof render>;
  // Commit the native tree before flushing effects that invoke UI methods.
  await act(async () => {
    result = render(ui, { enableMainThread: true });
  });
  return result!;
}

function input(value: string) {
  act(() => {
    elementTree.root!.querySelector('[data-automation-id=input]')!.dispatchEvent(
      new CustomEvent('bindEvent:input', {
        detail: { value, selectionStart: value.length, selectionEnd: value.length },
      }),
    );
  });
}

test('native Input synchronizes external values without echoing input or emitting changes', async () => {
  const onChange = rstest.fn();
  const { rerender } = await renderFixture(
    <Input data-automation-id="input" value="initial" onChange={onChange} />,
  );
  expect(write).toHaveBeenCalledExactlyOnceWith({
    method: 'setValue',
    params: { value: 'initial' },
  });
  input('initial');
  expect(onChange).not.toHaveBeenCalled();

  input('edited');
  expect(onChange).toHaveBeenCalledExactlyOnceWith('edited');
  rerender(<Input data-automation-id="input" value="edited" onChange={onChange} />);
  expect(write).toHaveBeenCalledTimes(1);

  rerender(<Input data-automation-id="input" value="" onChange={onChange} />);
  expect(write).toHaveBeenLastCalledWith({ method: 'setValue', params: { value: '' } });
  expect(write).toHaveBeenCalledTimes(2);
  input('');
  expect(onChange).toHaveBeenCalledTimes(1);
});

test('native Input does not forward changes while disabled or readonly', async () => {
  const onChange = rstest.fn();
  const { rerender } = await renderFixture(
    <Input data-automation-id="input" value="initial" disabled onChange={onChange} />,
  );
  input('disabled');
  rerender(<Input data-automation-id="input" value="initial" readonly onChange={onChange} />);
  input('readonly');
  expect(onChange).not.toHaveBeenCalled();
});

function focusEvent(type: 'focus' | 'blur') {
  act(() => {
    elementTree
      .root!.querySelector('[data-automation-id=input]')!
      .dispatchEvent(new CustomEvent(`bindEvent:${type}`, { detail: { value: 'initial' } }));
  });
}

function GroupFixture({
  bindfocus,
  bindblur,
  onAddonTap,
}: {
  bindfocus(): void;
  bindblur(): void;
  onAddonTap(): void;
}) {
  return (
    <view>
      <InputGroup data-automation-id="group" className="h-[40px]">
        <InputBeforeAddon data-automation-id="before" className="pl-[12px]">
          https://
        </InputBeforeAddon>
        <Input
          data-automation-id="input"
          value="initial"
          onChange={() => {}}
          bindfocus={bindfocus}
          bindblur={bindblur}
        />
        <InputAfterAddon data-automation-id="after">
          <view
            data-automation-id="addon-button"
            bindtap={() => {
              'background only';
              onAddonTap();
            }}
          >
            <text>.com</text>
          </view>
        </InputAfterAddon>
      </InputGroup>
      <InputGroup data-automation-id="other-group">
        <Input value="other" onChange={() => {}} />
      </InputGroup>
    </view>
  );
}

test('InputGroup composes addons and highlights only its own frame while the input is focused', async () => {
  const bindfocus = rstest.fn();
  const bindblur = rstest.fn();
  const onAddonTap = rstest.fn();
  await renderFixture(
    <GroupFixture bindfocus={bindfocus} bindblur={bindblur} onAddonTap={onAddonTap} />,
  );
  const root = elementTree.root!;
  const group = root.querySelector('[data-automation-id=group]')!;
  const otherGroup = root.querySelector('[data-automation-id=other-group]')!;
  const control = root.querySelector('[data-automation-id=input]')!;
  expect(group.className).toContain('h-[40px]');
  expect(control.className).toContain('border-0');
  expect(root.querySelector('[data-automation-id=before]')!.textContent).toBe('https://');
  expect(root.querySelector('[data-automation-id=before]')!.className).toContain('pl-[12px]');
  expect(root.querySelector('[data-automation-id=after]')!.textContent).toBe('.com');
  fireEvent.tap(root.querySelector('[data-automation-id=addon-button]')!);
  expect(onAddonTap).toHaveBeenCalledTimes(1);

  expect(group.className).toContain('border-[#39444e]');
  focusEvent('focus');
  expect(group.className).toContain('border-[#a8e6cf]');
  expect(otherGroup.className).toContain('border-[#39444e]');
  expect(bindfocus).toHaveBeenCalledTimes(1);
  focusEvent('blur');
  expect(group.className).toContain('border-[#39444e]');
  expect(bindblur).toHaveBeenCalledTimes(1);
});

function DisabledFixture({
  disabled = false,
  mounted = true,
  onChange,
}: {
  disabled?: boolean;
  mounted?: boolean;
  onChange(value: string): void;
}) {
  return (
    <InputGroup data-automation-id="group" disabled={disabled}>
      {mounted && <Input data-automation-id="input" value="initial" onChange={onChange} />}
    </InputGroup>
  );
}

test('InputGroup propagates disabled and clears focus when the control is disabled or unmounted', async () => {
  const onChange = rstest.fn();
  const { rerender } = await renderFixture(<DisabledFixture onChange={onChange} />);
  const group = elementTree.root!.querySelector('[data-automation-id=group]')!;
  focusEvent('focus');
  expect(group.className).toContain('border-[#a8e6cf]');
  rerender(<DisabledFixture onChange={onChange} disabled />);
  focusEvent('focus');
  input('disabled');
  expect(onChange).not.toHaveBeenCalled();
  expect(group.className).toContain('border-[#39444e]');
  expect(group.className).toContain('opacity-50');
  rerender(<DisabledFixture onChange={onChange} />);
  expect(group.className).toContain('border-[#39444e]');
  focusEvent('focus');
  rerender(<DisabledFixture onChange={onChange} mounted={false} />);
  expect(group.className).toContain('border-[#39444e]');
});

test('standalone Input keeps its border and composes focus callbacks', async () => {
  await renderFixture(<Input data-automation-id="input" value="initial" onChange={rstest.fn()} />);
  const control = elementTree.root!.querySelector('[data-automation-id=input]')!;
  focusEvent('focus');
  expect(control.className).toContain('border-[#a8e6cf]');
  focusEvent('blur');
  expect(control.className).toContain('border-[#39444e]');
});
