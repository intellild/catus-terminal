import type { TerminalTab } from '../state/session';

export function TabBar({ tabs = [], activeTabId, loading = false, onSelect, onClose, onAdd, onLayout }: {
  tabs?: readonly TerminalTab[];
  activeTabId?: string;
  loading?: boolean;
  onSelect?(id: string): void;
  onClose?(id: string): void;
  onAdd?(): void;
  onLayout?(): void;
}) {
  const width = Math.max(tabs.length * 198 + 10, 198);
  return <>
    <scroll-view scroll-x className="TabScroll" style={{ width: `${width}px` }}>
      <view className="TabList" style={{ width: `${width}px` }} bindlayoutchange={onLayout}>
        {tabs.map(tab => (
          <view id={`tab-item-${tab.number}`} key={tab.id} className={`Tab ${activeTabId === tab.id ? 'TabActive' : ''}`}>
            <view id={`tab-${tab.number}`} className="TabSelect" bindtap={() => onSelect?.(tab.id)}>
              <view className="TabDot" style={{ backgroundColor: tab.profile.color }} />
              <text className={`TabTitle ${activeTabId === tab.id ? 'TabTitleActive' : ''}`}>{`${tab.profile.name} ${tab.number}`}</text>
            </view>
            <view id={`close-tab-${tab.number}`} className="TabClose" bindtap={() => onClose?.(tab.id)}><text className="CloseGlyph">×</text></view>
          </view>
        ))}
        {!tabs.length && <text className="NoTabsLabel">{loading ? 'Opening workspace…' : 'No open tabs'}</text>}
      </view>
    </scroll-view>
    <view id="new-tab" className="NewTab" bindtap={onAdd}><text className="PlusGlyph">+</text></view>
  </>;
}
