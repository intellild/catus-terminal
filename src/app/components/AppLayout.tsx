import type { ReactNode } from '@lynx-js/react';

type LayoutChildren = { children?: ReactNode };

/** Compose the static first-frame layout with children in App.tsx. */
export function AppLayout({ children }: LayoutChildren) {
  return (
    <view
      id="application-layout"
      className="w-full h-full flex flex-col bg-[#101215] relative text-[#e3e5e8]"
    >
      {children}
    </view>
  );
}

export function AppLayoutHeader({ children }: LayoutChildren) {
  return (
    <view id="window-tab-bar" className="h-[38px] shrink-0 flex flex-row items-center pr-[12px]">
      {children}
    </view>
  );
}

export function AppLayoutHeaderContent({ children }: LayoutChildren) {
  return (
    <view className="flex-1 min-w-0 h-full flex flex-row items-center pr-[12px]">{children}</view>
  );
}

export function AppLayoutBody({ children }: LayoutChildren) {
  return <view className="flex-1 min-h-0 flex flex-row">{children}</view>;
}

export function AppLayoutSidebar({ children }: LayoutChildren) {
  return (
    <view
      id="workspace-dock"
      className="w-12 shrink-0 flex flex-col items-center bg-[#181b20] border-r border-solid border-[#282c32] py-[6px]"
    >
      {children}
    </view>
  );
}

export function AppLayoutMain({ children }: LayoutChildren) {
  return <view className="flex-1 min-w-0 flex flex-col">{children}</view>;
}

export function AppLayoutContent({ children }: LayoutChildren) {
  return (
    <view id="terminal-content" className="flex-1 min-h-0 flex flex-col">
      {children}
    </view>
  );
}

export function AppLayoutFooter({ children }: LayoutChildren) {
  return (
    <view
      id="application-status"
      className="h-[26px] flex flex-row items-center justify-between py-0 px-[16px] bg-[#181c21] border-t border-solid border-[#2a3037] shrink-0"
    >
      {children}
    </view>
  );
}
