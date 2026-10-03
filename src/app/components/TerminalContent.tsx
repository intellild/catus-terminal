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
    <view className="h-[57px] flex flex-row items-center justify-between py-0 px-[25px] border-b border-solid border-[#272c32] shrink-0">
      <view className="flex flex-row items-center gap-[12px]">
        <text className="text-[16px] font-bold text-[color:var(--workspace-color)]" style={`--workspace-color: ${workspace?.color ?? '#a8e6cf'}`}>{workspace?.icon ?? '>_'}</text>
        <text id="active-workspace" className="text-[13px] font-bold text-[#d8dee5]">{workspace?.name ?? 'Workspaces'}</text>
        <text className="text-[14px] text-[#515c6a]">/</text>
        <text className="text-[12px] text-[#8993a1]">{tabCount} {tabCount === 1 ? 'tab' : 'tabs'}</text>
      </view>
      <view id="edit-workspace" className="py-[8px] px-[12px] border border-solid border-[#323a43] rounded-[7px]" bindtap={onSettings}><text className="text-[11px] text-[#adb7c4]">Configure workspace</text></view>
    </view>

    <view className="flex-1 min-h-0 flex flex-col bg-[#111419] m-[16px] border border-solid border-[#272d35] rounded-[12px] overflow-hidden">
      {error ? <view className="flex-1 flex flex-col items-center justify-center py-[18px] px-[30px]">
        <text className="text-[27px] font-medium text-[#dce3e7] text-center mb-[12px]">Could not load workspaces</text>
        <text id="config-error" className="text-[11px] text-[#e4a4a4] leading-[18px] mt-[12px] break-all">{error}</text>
        <view id="retry-config" className="py-[10px] px-[16px] rounded-[7px] bg-[#a8e6cf] mt-[15px]" bindtap={onRetry}><text className="text-[12px] font-bold text-[#20392f]">Try again</text></view>
      </view> : <>
        <view className="h-[55px] py-0 px-[24px] flex flex-row items-center justify-between shrink-0">
          <view className="flex flex-row items-center gap-[10px] flex-1 min-w-0"><text className="text-[18px] text-[#778b86]">~</text><text id="session-directory" className="text-[11px] text-[#76818e] overflow-hidden text-ellipsis whitespace-nowrap">{launch?.cwd ?? 'Choose a workspace'}</text></view>
          <text id="session-label" className="text-[9px] text-[#65717f] tracking-[1px] ml-[12px]">{activeTab ? `SESSION ${String(activeTab.number).padStart(2, '0')}` : 'NO SESSION'}</text>
        </view>
        <view className="flex-1 flex flex-col items-center justify-center py-[18px] px-[30px]">
          <view className="w-[78px] h-[68px] border border-solid border-[#35463f] rounded-[17px] bg-[#19231f] flex items-center justify-center mb-[26px]"><text className="text-[30px] font-bold text-[color:var(--workspace-color)]" style={`--workspace-color: ${workspace?.color ?? '#a8e6cf'}`}>{workspace?.icon ?? '>_'}</text></view>
          <text className="text-[9px] text-[#71837e] tracking-[2px] mb-[13px]">{activeTab ? `${activeTab.profile.name.toUpperCase()} WORKSPACE` : 'YOUR WORKSPACE'}</text>
          <text id="terminal-placeholder" className="text-[27px] font-medium text-[#dce3e7] text-center mb-[12px]">{loading ? 'Getting things ready.' : activeTab ? 'A little space to make things.' : 'Start something new.'}</text>
          <text className="text-[13px] text-[#7c8998] leading-[22px] text-center">{activeTab ? 'Your terminal content will appear here.' : 'Open a terminal tab in this workspace.'}</text>
          {activeTab ? <view className="mt-[25px] flex flex-row items-center gap-[10px] py-[10px] px-[17px] border border-solid border-[#2e373d] rounded-[8px] bg-[#1b2025] max-w-full"><text className="text-[12px] text-[#a8e6cf]">$</text><text id="session-command" className="text-[12px] text-[#b6c0cc] overflow-hidden text-ellipsis whitespace-nowrap">{command}</text></view>
            : !loading && <view id="start-terminal" className="py-[10px] px-[16px] rounded-[7px] bg-[#a8e6cf] mt-[15px]" bindtap={onAdd}><text className="text-[12px] font-bold text-[#20392f]">+ New terminal</text></view>}
          <text className="mt-[26px] text-[8px] tracking-[1.5px] text-[#4a5665]">TERMINAL CONTENT PLACEHOLDER</text>
        </view>
        <view className="py-[17px] px-[24px] flex flex-row justify-between shrink-0"><text className="text-[9px] text-[#596574]">{workspace?.name ?? 'Catus'} · {activeTab ? `Tab ${activeTab.number}` : 'No open tabs'}</text><text className="text-[9px] text-[#596574]">A place for every kind of work.</text></view>
      </>}
    </view>

  </>;
}
