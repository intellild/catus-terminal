import { expect, test } from '@rstest/core';
import { render } from '@lynx-js/react/testing-library';
import { Icon } from '../components/ui/icon';

test('Icon renders a Lucide SVG string with the requested color and size', () => {
  render(
    <Icon
      data-automation-id="icon"
      name="x"
      size={14}
      color="#123456"
      strokeWidth={1.5}
      className="opacity-70"
    />,
    { enableMainThread: true },
  );
  const icon = elementTree.root!.querySelector('[data-automation-id=icon]')!;
  expect(icon.tagName.toLowerCase()).toBe('svg');
  expect(icon.getAttribute('class')).toContain('shrink-0');
  expect(icon.getAttribute('class')).toContain('opacity-70');
  expect(icon.getAttribute('style')).toContain('14px');

  const content = icon.getAttribute('content')!;
  expect(content).toContain('viewBox="0 0 24 24"');
  expect(content).toContain('stroke="#123456"');
  expect(content).toContain('stroke-width="1.5"');
  expect(content).toContain('<path d="M18 6 6 18" />');
  expect(content).not.toContain('currentColor');
  expect(content).not.toContain('class="lucide');
  expect(content).not.toContain('width="24"');
});

test('Icon defaults to the primary text color, 16px and a 2px stroke', () => {
  render(<Icon data-automation-id="icon" name="plus" />, { enableMainThread: true });
  const icon = elementTree.root!.querySelector('[data-automation-id=icon]')!;
  expect(icon.getAttribute('style')).toContain('16px');
  expect(icon.getAttribute('content')).toContain('stroke="#e2e8ed"');
  expect(icon.getAttribute('content')).toContain('stroke-width="2"');
});
