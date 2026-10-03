import '@testing-library/jest-dom';
import { expect, test } from '@rstest/core';
import { act, fireEvent, getQueriesForElement, render } from '@lynx-js/react/testing-library';
import { NativeDemo } from '../NativeDemo.jsx';

test('native input events update ReactLynx state, including empty and Unicode values', async () => {
  render(<NativeDemo />);
  const root = elementTree.root!;
  const input = root.querySelector('native-input')!;
  const { findByText } = getQueriesForElement(root);

  // Lynx's test environment names custom event bindings bindEvent:<name>.
  act(() => {
    input.dispatchEvent(
      new CustomEvent('bindEvent:input', {
        detail: { value: '你好 Lynxtron' },
      }),
    );
  });
  expect(await findByText('你好 Lynxtron')).toBeInTheDocument();
  expect(await findByText('Received input event from NSTextField')).toBeInTheDocument();

  act(() => {
    input.dispatchEvent(
      new CustomEvent('bindEvent:input', {
        detail: { value: '' },
      }),
    );
  });
  expect(await findByText('(empty)')).toBeInTheDocument();
});

test('property updates reach the custom element on repeated taps', async () => {
  render(<NativeDemo />);
  const root = elementTree.root!;
  const { findByText } = getQueriesForElement(root);
  const button = root.querySelector('#update-property')!;

  fireEvent.tap(button);
  expect(await findByText('Updated from ReactLynx #1')).toBeInTheDocument();
  expect(root.querySelector('native-input')?.getAttribute('value')).toBe(
    'Updated from ReactLynx #1',
  );

  fireEvent.tap(button);
  expect(await findByText('Updated from ReactLynx #2')).toBeInTheDocument();
  expect(root.querySelector('native-input')?.getAttribute('value')).toBe(
    'Updated from ReactLynx #2',
  );
});
