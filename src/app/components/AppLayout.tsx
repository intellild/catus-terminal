import { cn } from '../lib/utils';
import type { ReactNode } from '@lynx-js/react';

type LayoutChildren = { children?: ReactNode };

/** Compose the static first-frame layout with children in App.tsx. */
export function AppLayout({ children }: LayoutChildren) {
  return (
    <view
      id="application-layout"
      className={cn('w-full h-full flex flex-col bg-[#101215] relative text-[#e3e5e8]')}
    >
      {children}
    </view>
  );
}

export function AppLayoutHeader({ children }: LayoutChildren) {
  return (
    <view
      id="window-tab-bar"
      className={cn(
        'h-[54px] shrink-0 flex flex-row bg-[#1b1e23] border-b border-solid border-[#2b3036]',
      )}
    >
      {children}
    </view>
  );
}

export function AppLayoutHeaderContent({ children }: LayoutChildren) {
  return (
    <view className={cn('flex-1 min-w-0 h-[54px] flex flex-row items-center pr-[20px]')}>
      {children}
    </view>
  );
}

export function AppLayoutBody({ children }: LayoutChildren) {
  return <view className={cn('flex-1 min-h-0 flex flex-row')}>{children}</view>;
}

export function AppLayoutSidebar({ children }: LayoutChildren) {
  return (
    <view
      id="workspace-dock"
      className={cn(
        'w-[80px] shrink-0 flex flex-col items-center bg-[#181b20] border-r border-solid border-[#282c32] pt-[18px] px-[8px] pb-[12px]',
      )}
    >
      {children}
    </view>
  );
}

export function AppLayoutMain({ children }: LayoutChildren) {
  return <view className={cn('flex-1 min-w-0 flex flex-col')}>{children}</view>;
}

export function AppLayoutContent({ children }: LayoutChildren) {
  return (
    <view id="terminal-content" className={cn('flex-1 min-h-0 flex flex-col')}>
      {children}
    </view>
  );
}

export function AppLayoutFooter({ children }: LayoutChildren) {
  return (
    <view
      id="application-status"
      className={cn(
        'h-[30px] flex flex-row items-center justify-between py-0 px-[22px] bg-[#181c21] border-t border-solid border-[#2a3037] shrink-0',
      )}
    >
      {children}
    </view>
  );
}
