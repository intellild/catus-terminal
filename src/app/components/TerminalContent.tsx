import type { Workspace } from '../../shared/workspaces';
import type { TerminalTab } from '../state/session';

export function TerminalContent({ workspace, activeTab, tabCount = 0, launch, command = '', loading = false, error = '', onSettings, onRetry, onAdd }: {
  workspace?: Workspace;
  activeTab?: TerminalTab;
  tabCount?: number;
  launch?: { cwd: string } | null;
  command?: string;
  loading?: boolean;
  error?: string;
  onSettings?(): void;
  onRetry?(): void;
  onAdd?(): void;
}) {
  return <>
    <view className="WorkspaceToolbar">
      <view className="ToolbarLeading">
        <text className="ToolbarIcon" style={{ color: workspace?.color ?? '#a8e6cf' }}>{workspace?.icon ?? '>_'}</text>
        <text id="active-workspace" className="ToolbarTitle">{workspace?.name ?? 'Workspaces'}</text>
        <text className="ToolbarSlash">/</text>
        <text className="ToolbarDetail">{tabCount} {tabCount === 1 ? 'tab' : 'tabs'}</text>
      </view>
      <view id="edit-workspace" className="ToolbarButton" bindtap={onSettings}><text className="ToolbarButtonText">Configure workspace</text></view>
    </view>

    <view className="TerminalStage">
      {error ? <view className="EmptyState">
        <text className="EmptyTitle">Could not load workspaces</text>
        <text id="config-error" className="ErrorText">{error}</text>
        <view id="retry-config" className="PrimaryButton" bindtap={onRetry}><text className="PrimaryButtonText">Try again</text></view>
      </view> : <>
        <view className="StageHeading">
          <view className="StagePath"><text className="PathTilde">~</text><text id="session-directory" className="PathText">{launch?.cwd ?? 'Choose a workspace'}</text></view>
          <text id="session-label" className="SessionBadge">{activeTab ? `SESSION ${String(activeTab.number).padStart(2, '0')}` : 'NO SESSION'}</text>
        </view>
        <view className="EmptyState">
          <view className="TerminalSymbol"><text className="TerminalSymbolText" style={{ color: workspace?.color ?? '#a8e6cf' }}>{workspace?.icon ?? '>_'}</text></view>
          <text className="EmptyEyebrow">{activeTab ? `${activeTab.profile.name.toUpperCase()} WORKSPACE` : 'YOUR WORKSPACE'}</text>
          <text id="terminal-placeholder" className="EmptyTitle">{loading ? 'Getting things ready.' : activeTab ? 'A little space to make things.' : 'Start something new.'}</text>
          <text className="EmptyDescription">{activeTab ? 'Your terminal content will appear here.' : 'Open a terminal tab in this workspace.'}</text>
          {activeTab ? <view className="CommandPill"><text className="CommandPrompt">$</text><text id="session-command" className="CommandText">{command}</text></view>
            : !loading && <view id="start-terminal" className="PrimaryButton" bindtap={onAdd}><text className="PrimaryButtonText">+ New terminal</text></view>}
          <text className="PlaceholderNote">TERMINAL CONTENT PLACEHOLDER</text>
        </view>
        <view className="StageFooter"><text className="StageFooterText">{workspace?.name ?? 'Catus'} · {activeTab ? `Tab ${activeTab.number}` : 'No open tabs'}</text><text className="StageFooterText">A place for every kind of work.</text></view>
      </>}
    </view>

  </>;
}
