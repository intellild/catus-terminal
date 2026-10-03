import type { Workspace } from '../../shared/workspaces';

export function WorkspaceList({ workspaces = [], activeWorkspaceId, runningIds = new Set<string>(), loading = false, onSelect, onSettings }: {
  workspaces?: readonly Workspace[];
  activeWorkspaceId?: string | null;
  runningIds?: ReadonlySet<string>;
  loading?: boolean;
  onSelect?(id: string): void;
  onSettings?(): void;
}) {
  return <>
    <scroll-view scroll-y className="WorkspaceScroll">
      <view className="WorkspaceList">
        {loading && !workspaces.length && [0, 1, 2].map(index => <view key={index} className="WorkspaceSkeleton"><view className="WorkspaceIcon SkeletonIcon" /><view className="SkeletonName" /></view>)}
        {workspaces.map(item => (
          <view id={`workspace-${item.id}`} key={item.id}
            className={`WorkspaceItem ${activeWorkspaceId === item.id ? 'WorkspaceSelected' : ''}`}
            bindtap={() => onSelect?.(item.id)}>
            <view className="WorkspaceIcon" style={{ backgroundColor: activeWorkspaceId === item.id ? item.color : '#25292f' }}>
              <text className={`WorkspaceGlyph ${activeWorkspaceId === item.id ? 'WorkspaceGlyphSelected' : ''}`}>{item.icon}</text>
            </view>
            <text className="WorkspaceName">{item.name}</text>
            <view className="DotSlot">
              {runningIds.has(item.id) && <view id={`running-${item.id}`} className="RunningDot" style={{ backgroundColor: item.color }} />}
            </view>
          </view>
        ))}
      </view>
    </scroll-view>
    <view id="workspace-settings" className="DockSettings" bindtap={onSettings}><text className="SettingsGlyph">⚙</text></view>
  </>;
}
