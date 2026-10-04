import type { TerminalTab } from '../state/session';

export function TabBar({
  tabs = [],
  activeTabId,
  loading = false,
  onSelect,
  onClose,
  onAdd,
  onLayout,
}: {
  tabs?: readonly TerminalTab[];
  activeTabId?: number;
  loading?: boolean;
  onSelect?(id: number): void;
  onClose?(id: number): void;
  onAdd?(): void;
  onLayout?(): void;
}) {
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
              className={`w-[192px] h-[43px] shrink-0 rounded-t-[10px] rounded-b-none flex flex-row items-center [-x-app-region:no-drag] ${activeTabId === tab.id ? 'bg-[#2b3037] border-t border-solid border-[#46504f]' : 'bg-[#22262c]'}`}
            >
              <view
                id={`tab-${tab.number}`}
                className="flex-1 min-w-0 h-[43px] flex flex-row items-center pl-[15px] gap-[9px]"
                bindtap={() => onSelect?.(tab.id)}
              >
                <view
                  className="w-[6px] h-[6px] rounded-[3px] shrink-0 bg-[var(--workspace-color)]"
                  style={`--workspace-color: ${tab.profile.color}`}
                />
                <text
                  className={`text-[12px] whitespace-nowrap overflow-hidden text-ellipsis ${activeTabId === tab.id ? 'text-[#e1e8e5]' : 'text-[#959eaa]'}`}
                >{`${tab.profile.name} ${tab.number}`}</text>
              </view>
              <view
                id={`close-tab-${tab.number}`}
                className="w-[31px] h-[38px] flex justify-center items-center shrink-0"
                bindtap={() => onClose?.(tab.id)}
              >
                <text className="text-[19px] text-[#9ca6b2]">×</text>
              </view>
            </view>
          ))}
          {!tabs.length && (
            <text className="py-[16px] px-[12px] text-[12px] text-[#7f8996]">
              {loading ? 'Opening workspace…' : 'No open tabs'}
            </text>
          )}
        </view>
      </scroll-view>
      <view
        id="new-tab"
        className="w-[36px] h-[36px] rounded-[9px] flex justify-center items-center ml-[8px] shrink-0 [-x-app-region:no-drag]"
        bindtap={onAdd}
      >
        <text className="text-[24px] text-[#c1c7d0]">+</text>
      </view>
    </>
  );
}
