import { expect, rstest, test } from '@rstest/core';
import { act, fireEvent, render } from '@lynx-js/react/testing-library';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '../components/ui/Dialog';

function Fixture({
  open,
  defaultOpen,
  onOpenChange,
  disabled,
  closeOnPress = true,
  showCloseButton = true,
}: {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?(open: boolean): void;
  disabled?: boolean;
  closeOnPress?: boolean;
  showCloseButton?: boolean;
}) {
  return (
    <Dialog open={open} defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
      <DialogTrigger data-automation-id="trigger" disabled={disabled}>
        Open
      </DialogTrigger>
      <DialogContent
        data-automation-id="dialog"
        className="w-[400px]"
        showCloseButton={showCloseButton}
        overlayProps={{ 'data-automation-id': 'overlay', closeOnPress }}
        closeButtonProps={{ 'data-automation-id': 'default-close' }}
      >
        <DialogHeader data-automation-id="header">
          <DialogTitle>Title</DialogTitle>
          <DialogDescription>Description</DialogDescription>
        </DialogHeader>
        <view data-automation-id="body">
          <text>Body</text>
        </view>
        <DialogFooter data-automation-id="footer">
          <DialogClose data-automation-id="close">Close</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const node = (id: string) => elementTree.root!.querySelector(`[data-automation-id=${id}]`);
const tap = (id: string) => fireEvent.tap(node(id)!);
const renderFixture = async (props: Parameters<typeof Fixture>[0] = {}) => {
  let result: ReturnType<typeof render>;
  await act(async () => {
    result = render(<Fixture {...props} />, { enableMainThread: true });
  });
  return result!;
};

test('Dialog composes its content and overlay inside a cover view and cleans them up on close', async () => {
  const onOpenChange = rstest.fn();
  await renderFixture({ onOpenChange });
  expect(node('dialog')).toBeNull();
  tap('trigger');
  expect(onOpenChange).toHaveBeenLastCalledWith(true);
  const content = node('dialog')!;
  expect(content.parentElement!.tagName.toLowerCase()).toBe('cover-view');
  expect(node('overlay')!.parentElement).toBe(content.parentElement);
  expect(content.parentElement!.getAttribute('events-pass-through')).toBe('false');
  expect(content.className).toContain('w-[400px]');
  expect(node('header')!.textContent).toBe('TitleDescription');
  expect(node('footer')!.textContent).toBe('Close');
  tap('body');
  expect(node('dialog')).not.toBeNull();
  tap('overlay');
  expect(onOpenChange).toHaveBeenLastCalledWith(false);
  expect(node('dialog')).toBeNull();
  expect(elementTree.root!.querySelector('cover-view')).toBeNull();
  tap('trigger');
  tap('default-close');
  expect(node('dialog')).toBeNull();
  tap('trigger');
  tap('close');
  expect(node('dialog')).toBeNull();
});

test('Dialog controlled state only changes after the owner updates open', async () => {
  const onOpenChange = rstest.fn();
  const { rerender } = await renderFixture({ open: false, onOpenChange });
  tap('trigger');
  expect(onOpenChange).toHaveBeenLastCalledWith(true);
  expect(node('dialog')).toBeNull();
  rerender(<Fixture open onOpenChange={onOpenChange} />);
  tap('close');
  expect(onOpenChange).toHaveBeenLastCalledWith(false);
  expect(node('dialog')).not.toBeNull();
  rerender(<Fixture open={false} onOpenChange={onOpenChange} />);
  expect(node('dialog')).toBeNull();
});

test('Dialog supports defaultOpen and optional overlay dismissal and close button', async () => {
  await renderFixture({ defaultOpen: true, closeOnPress: false, showCloseButton: false });
  expect(node('dialog')).not.toBeNull();
  expect(node('default-close')).toBeNull();
  tap('overlay');
  expect(node('dialog')).not.toBeNull();
  tap('close');
  expect(node('dialog')).toBeNull();
});

test('disabled DialogTrigger does not open a dialog', async () => {
  const onOpenChange = rstest.fn();
  await renderFixture({ disabled: true, onOpenChange });
  tap('trigger');
  expect(node('dialog')).toBeNull();
  expect(onOpenChange).not.toHaveBeenCalled();
});
