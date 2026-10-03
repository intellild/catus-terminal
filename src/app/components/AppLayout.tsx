import type { ReactNode } from '@lynx-js/react';

type LayoutChildren = { children?: ReactNode };

/** Compose the static first-frame layout with children in App.tsx. */
export function AppLayout({ children }: LayoutChildren) {
  return <view id="application-layout" className="Application">{children}</view>;
}

export function AppLayoutHeader({ children }: LayoutChildren) {
  return <view id="window-tab-bar" className="WindowChrome">{children}</view>;
}

export function AppLayoutHeaderContent({ children }: LayoutChildren) {
  return <view className="TabChrome">{children}</view>;
}

export function AppLayoutBody({ children }: LayoutChildren) {
  return <view className="ApplicationBody">{children}</view>;
}

export function AppLayoutSidebar({ children }: LayoutChildren) {
  return <view id="workspace-dock" className="WorkspaceDock">{children}</view>;
}

export function AppLayoutMain({ children }: LayoutChildren) {
  return <view className="MainPane">{children}</view>;
}

export function AppLayoutContent({ children }: LayoutChildren) {
  return <view id="terminal-content" className="ContentArea">{children}</view>;
}

export function AppLayoutFooter({ children }: LayoutChildren) {
  return <view id="application-status" className="StatusBar">{children}</view>;
}
