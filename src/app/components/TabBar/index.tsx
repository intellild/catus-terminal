import { Button } from '../ui/Button';
import type { ReactNode } from '@lynx-js/react';
import { useTranslation } from '../../i18n';

export function TabBar({ children }: { children?: ReactNode }) {
  return (
    <scroll-view id="tab-bar-scroll" scroll-x className="shrink min-w-0 h-full">
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
  const width = Math.max(tabCount * 198 + 10, 198);
  return (
    <view
      className="h-12 flex flex-row items-end pl-[10px] gap-[6px] w-[var(--tab-width)]"
      style={`--tab-width: ${width}px`}
    >
      {children}
      {!tabCount && (
        <text className="py-[10px] px-[12px] text-[12px] text-[#7f8996]">
          {t(loading ? 'tabs.opening' : 'tabs.empty')}
        </text>
      )}
    </view>
  );
}

export function TabActions({ onAdd, onAddSftp }: { onAdd?(): void; onAddSftp?(): void }) {
  const { t } = useTranslation();
  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        id="new-tab"
        className="rounded-[9px] ml-[8px]"
        bindtap={onAdd}
      >
        <text className="text-[20px] text-[#c1c7d0]">+</text>
      </Button>
      {onAddSftp ? (
        <Button
          variant="ghost"
          id="new-sftp-tab"
          className="h-7 px-[9px] rounded-[9px] font-normal"
          bindtap={onAddSftp}
        >
          <text className="text-[12px] text-[#a8e6cf]">{t('tabs.newSftp')}</text>
        </Button>
      ) : null}
    </>
  );
}
