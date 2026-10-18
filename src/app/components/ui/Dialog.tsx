import { createContext, useContext } from '@lynx-js/react';
import type { ReactNode } from '@lynx-js/react';
import type { TextProps, ViewProps } from '@lynx-js/types';
import { useTranslation } from '../../i18n';
import { cn } from '../../lib/utils';
import { Button } from './Button';
import type { ButtonProps } from './Button';
import { CoverView } from './CoverView';
import { Icon } from './Icon';
import type { PopoverOptions } from './popoverState';
import { usePopoverState } from './usePopoverState';

const DialogContext = createContext<{
  open: boolean;
  setOpen(open: boolean): void;
} | null>(null);

export function useDialog() {
  const context = useContext(DialogContext);
  if (!context) {
    throw new Error('Dialog components require Dialog');
  }
  return context;
}

export interface DialogProps extends PopoverOptions {
  children?: ReactNode;
}

export function Dialog({ children, ...options }: DialogProps) {
  // Share the Effect-backed open/close controller, without popover positioning.
  const { open, setOpen } = usePopoverState(options);
  return <DialogContext.Provider value={{ open, setOpen }}>{children}</DialogContext.Provider>;
}

export function DialogTrigger({ bindtap, ...props }: ButtonProps) {
  const { setOpen } = useDialog();
  return (
    <Button
      {...props}
      bindtap={(event) => {
        'background only';
        bindtap?.(event);
        setOpen(true);
      }}
    />
  );
}

export function DialogClose({ bindtap, ...props }: ButtonProps) {
  const { setOpen } = useDialog();
  const { t } = useTranslation();
  return (
    <Button
      accessibility-label={t('common.close')}
      {...props}
      bindtap={(event) => {
        'background only';
        bindtap?.(event);
        setOpen(false);
      }}
    />
  );
}

export function DialogPortal({
  children,
  className,
  ...props
}: ViewProps & { children?: ReactNode }) {
  const { open } = useDialog();
  return open ? (
    <CoverView
      {...props}
      className={cn(
        'fixed inset-0 flex items-center justify-center [-x-app-region:no-drag]',
        className,
      )}
    >
      {children}
    </CoverView>
  ) : null;
}

export interface DialogOverlayProps extends ViewProps {
  closeOnPress?: boolean;
  'data-automation-id'?: string;
}

export function DialogOverlay({
  closeOnPress = true,
  className,
  bindtap,
  ...props
}: DialogOverlayProps) {
  const { setOpen } = useDialog();
  return (
    <Button
      variant="ghost"
      {...props}
      className={cn(
        'absolute inset-0 w-full h-full p-0 rounded-none bg-[#00000080] hover:bg-[#00000080]',
        className,
      )}
      bindtap={(event) => {
        'background only';
        bindtap?.(event);
        if (closeOnPress) {
          setOpen(false);
        }
      }}
    />
  );
}

export interface DialogContentProps extends ViewProps {
  children?: ReactNode;
  showCloseButton?: boolean;
  overlayProps?: DialogOverlayProps;
  closeButtonProps?: ButtonProps & { 'data-automation-id'?: string };
}

export function DialogContent({
  children,
  className,
  showCloseButton = true,
  overlayProps,
  closeButtonProps,
  ...props
}: DialogContentProps) {
  return (
    <DialogPortal>
      <DialogOverlay {...overlayProps} />
      <view
        {...props}
        className={cn(
          'relative w-[520px] max-w-[90%] max-h-[90%] flex flex-col p-[24px] rounded-[14px] bg-[#20262d] border border-solid border-[#39444e] [-x-app-region:no-drag]',
          className,
        )}
      >
        {children}
        {showCloseButton ? (
          <DialogClose
            variant="ghost"
            size="icon-sm"
            {...closeButtonProps}
            className={cn('absolute top-[18px] right-[20px]', closeButtonProps?.className)}
          >
            {closeButtonProps?.children ?? <Icon name="x" size={18} color="#9ca6b2" />}
          </DialogClose>
        ) : null}
      </view>
    </DialogPortal>
  );
}

export function DialogHeader({
  children,
  className,
  ...props
}: ViewProps & { children?: ReactNode }) {
  return (
    <view {...props} className={cn('flex flex-col gap-[6px] pr-[32px] mb-[14px]', className)}>
      {children}
    </view>
  );
}

export function DialogFooter({
  children,
  className,
  ...props
}: ViewProps & { children?: ReactNode }) {
  return (
    <view {...props} className={cn('flex flex-row justify-end gap-[14px] mt-[20px]', className)}>
      {children}
    </view>
  );
}

export function DialogTitle({
  children,
  className,
  ...props
}: TextProps & { children?: ReactNode }) {
  return (
    <text {...props} className={cn('text-[18px] text-[#e2e8ed]', className)}>
      {children}
    </text>
  );
}

export function DialogDescription({
  children,
  className,
  ...props
}: TextProps & { children?: ReactNode }) {
  return (
    <text {...props} className={cn('text-[12px] text-[#9ca6b2] leading-[18px]', className)}>
      {children}
    </text>
  );
}
