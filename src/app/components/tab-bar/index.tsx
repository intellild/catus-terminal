import type { ReactNode } from '@lynx-js/react';
import { useTranslation } from '../../i18n';

export function TabBar({ children }: { children?: ReactNode }) {
  return (
    <scroll-view data-automation-id="tab-bar-scroll" scroll-x className="shrink min-w-0 h-full">
      {children}
    </scroll-view>
  );
}

export function TabList({
  children,
  tabCount = 0,
  loading = false,
}: {
  children?: ReactNode;
  tabCount?: number;
  loading?: boolean;
}) {
  const { t } = useTranslation();
  const width = Math.max(tabCount * 184 + 6, 184);
  return (
    <view
      className="h-full flex flex-row items-end pl-[6px] gap-[4px] w-[var(--tab-width)]"
      style={`--tab-width: ${width}px`}
    >
      {children}
      {!tabCount && (
        <view className="h-[32px] flex flex-row items-center px-[10px]">
          <text className="text-[12px] text-[#7f8996]">
            {t(loading ? 'tabs.opening' : 'tabs.empty')}
          </text>
        </view>
      )}
    </view>
  );
}
