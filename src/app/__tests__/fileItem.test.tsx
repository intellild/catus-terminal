import { expect, rstest, test } from '@rstest/core';
import { fireEvent, render } from '@lynx-js/react/testing-library';
import { FileItem } from '../components/FileExplorer';

const file = { name: 'readme.txt', directory: false, symlink: false };

test('FileItem renders a caller action before the type icon', () => {
  const onOpen = rstest.fn();
  render(
    <FileItem
      entry={file}
      automationId="file-entry"
      action={<text data-automation-id="download">D</text>}
      onOpen={onOpen}
    />,
    { enableMainThread: true },
  );
  const row = elementTree.root!.querySelector('[data-automation-id=file-entry]')!;
  expect(row.children[0]?.querySelector('[data-automation-id=download]')).not.toBeNull();
  expect(row.children[1]?.querySelector('svg')).not.toBeNull();
  expect(row.textContent).toContain('readme.txt');
  expect(row.textContent).toContain('File');
  fireEvent.tap(row);
  expect(onOpen).toHaveBeenCalledWith(file);
});

test('FileItem reserves the action slot when a directory has no action', () => {
  render(
    <FileItem
      entry={{ name: 'docs', directory: true, symlink: false }}
      automationId="file-entry"
      reserveAction
      onOpen={() => {}}
    />,
    { enableMainThread: true },
  );
  const row = elementTree.root!.querySelector('[data-automation-id=file-entry]')!;
  expect(row.children[0]?.querySelector('[data-automation-id=download]')).toBeNull();
  expect(row.children[1]?.querySelector('svg')).not.toBeNull();
  expect(row.textContent).toContain('Directory');
});
