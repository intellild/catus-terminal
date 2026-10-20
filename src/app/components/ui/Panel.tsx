import type { ReactNode } from '@lynx-js/react';
import { cn } from '../../lib/utils';

type PanelPartProps = {
  children?: ReactNode;
  className?: string;
};

/** Composable panel shell following shadcn's sectioned layout. */
export function Panel({ children, className }: PanelPartProps) {
  return (
    <view
      className={cn(
        'flex-1 min-h-0 flex flex-col bg-[#111419] border border-solid border-[#272d35] overflow-hidden',
        className,
      )}
    >
      {children}
    </view>
  );
}

export function PanelHeader({ children, className }: PanelPartProps) {
  return (
    <view
      className={cn(
        'h-[36px] py-0 px-[16px] flex flex-row items-center justify-between shrink-0',
        className,
      )}
    >
      {children}
    </view>
  );
}

export function PanelTitle({ children, className }: PanelPartProps) {
  return (
    <view className={cn('flex flex-row items-center gap-[8px] flex-1 min-w-0', className)}>
      {children}
    </view>
  );
}

export function PanelActions({ children, className }: PanelPartProps) {
  return (
    <view className={cn('flex flex-row items-center gap-[8px] ml-[12px] shrink-0', className)}>
      {children}
    </view>
  );
}

export function PanelContent({ children, className }: PanelPartProps) {
  return <view className={cn('flex-1 min-h-0 flex flex-col', className)}>{children}</view>;
}

export function PanelFooter({ children, className }: PanelPartProps) {
  return (
    <view className={cn('py-[8px] px-[16px] flex flex-row justify-between shrink-0', className)}>
      {children}
    </view>
  );
}
