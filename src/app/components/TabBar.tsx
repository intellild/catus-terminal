import { Button } from './ui/Button';
import { useTranslation } from '../i18n';
import { cn } from '../lib/utils';
import type { TerminalTab } from '../state/session';

export function TabBar({
  tabs = [],
  activeTabId,
  loading = false,
  onSelect,
  onClose,
  onAdd,
  onAddSftp,
  onLayout,
}: {
  tabs?: readonly TerminalTab[];
  activeTabId?: number;
  loading?: boolean;
  onSelect?(id: number): void;
  onClose?(id: number): void;
  onAdd?(): void;
  onAddSftp?(): void;
  onLayout?(): void;
}) {
  const { t } = useTranslation();
  const width = Math.max(tabs.length * 198 + 10, 198);
  return (
    <>
      <scroll-view
        scroll-x
        className="shrink min-w-0 h-[54px] w-[var(--tab-width)]"
        style={`--tab-width: ${width}px`}
      >
        <view
          className="h-[54px] flex flex-row items-end pl-[10px] gap-[6px] w-[var(--tab-width)]"
          bindlayoutchange={onLayout}
        >
          {tabs.map((tab) => (
            <view
              id={`tab-item-${tab.number}`}
              key={tab.id}
              className={cn(
                'w-[192px] h-[43px] shrink-0 rounded-t-[10px] rounded-b-none flex flex-row items-center [-x-app-region:no-drag]',
                activeTabId === tab.id
                  ? 'bg-[#2b3037] border-t border-solid border-[#46504f]'
                  : 'bg-[#22262c]',
              )}
            >
              <Button
                variant="ghost"
                id={`tab-${tab.number}`}
                className="flex-1 min-w-0 h-[43px] justify-start pl-[15px] pr-0 gap-[9px] rounded-tl-[10px] rounded-bl-none font-normal"
                bindtap={() => onSelect?.(tab.id)}
              >
                <view
                  className="w-[6px] h-[6px] rounded-[3px] shrink-0 bg-[var(--workspace-color)]"
                  style={`--workspace-color: ${tab.profile.color}`}
                />
                <text
                  className={cn(
                    'text-[12px] whitespace-nowrap overflow-hidden text-ellipsis',
                    activeTabId === tab.id ? 'text-[#e1e8e5]' : 'text-[#959eaa]',
                  )}
                >
                  {t(tab.kind === 'sftp' ? 'tabs.sftpTitle' : 'tabs.title', {
                    name: tab.profile.name,
                    number: tab.number,
                  })}
                </text>
              </Button>
              <Button
                variant="ghost"
                size="icon"
                id={`close-tab-${tab.number}`}
                className="w-[31px] h-[38px] flex justify-center items-center shrink-0"
                bindtap={() => onClose?.(tab.id)}
              >
                <text className="text-[19px] text-[#9ca6b2]">×</text>
              </Button>
            </view>
          ))}
          {!tabs.length && (
            <text className="py-[16px] px-[12px] text-[12px] text-[#7f8996]">
              {t(loading ? 'tabs.opening' : 'tabs.empty')}
            </text>
          )}
        </view>
      </scroll-view>
      <Button
        variant="ghost"
        size="icon"
        id="new-tab"
        className="rounded-[9px] ml-[8px]"
        bindtap={onAdd}
      >
        <text className="text-[24px] text-[#c1c7d0]">+</text>
      </Button>
      {onAddSftp ? (
        <Button
          variant="ghost"
          id="new-sftp-tab"
          className="px-[9px] rounded-[9px] font-normal"
          bindtap={onAddSftp}
        >
          <text className="text-[12px] text-[#a8e6cf]">{t('tabs.newSftp')}</text>
        </Button>
      ) : null}
    </>
  );
}
