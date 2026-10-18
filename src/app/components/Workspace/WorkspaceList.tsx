import type { ReactNode } from '@lynx-js/react';

export function WorkspaceList({
  children,
  loading = false,
  action,
}: {
  children?: ReactNode;
  loading?: boolean;
  action?: ReactNode;
}) {
  return (
    <>
      <scroll-view scroll-y className="w-12 flex-1 min-h-0">
        <view className="flex flex-col items-center gap-[6px] py-[2px]">
          {loading &&
            [0, 1, 2].map((index) => (
              <view key={index} className="w-9 h-9 rounded-[9px] bg-[#25292f]" />
            ))}
          {children}
        </view>
      </scroll-view>
      {action}
    </>
  );
}
