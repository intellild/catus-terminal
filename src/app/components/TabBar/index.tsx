import { Button } from '../ui/Button';
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

export function TabActions({ onAdd, onAddSftp }: { onAdd?(): void; onAddSftp?(): void }) {
  const { t } = useTranslation();
  return (
    <view className="h-full flex flex-row items-end pb-[4px] ml-[4px] gap-[2px]">
      <Button
        variant="ghost"
        size="icon-sm"
        data-automation-id="new-tab"
        className="w-[24px] h-[24px] rounded-[6px]"
        bindtap={onAdd}
      >
        <text className="text-[16px] text-[#c1c7d0]">+</text>
      </Button>
      {onAddSftp ? (
        <Button
          variant="ghost"
          data-automation-id="new-sftp-tab"
          className="h-[24px] px-[8px] rounded-[6px] font-normal"
          bindtap={onAddSftp}
        >
          <text className="text-[11px] text-[#a8e6cf]">{t('tabs.newSftp')}</text>
        </Button>
      ) : null}
    </view>
  );
}
