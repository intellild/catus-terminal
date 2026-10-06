import type { ReactNode } from '@lynx-js/react';
import type { Workspace } from '../../shared/workspaces';
import type { TerminalTab } from '../state/session';

export function TerminalContent({
  workspace,
  activeTab,
  tabCount = 0,
  loading = false,
  error = '',
  children,
  onSettings,
  onRetry,
  onAdd,
}: {
  children?: ReactNode;
  workspace?: Workspace;
  activeTab?: TerminalTab;
  tabCount?: number;
  loading?: boolean;
  error?: string;
  onSettings?(): void;
  onRetry?(): void;
  onAdd?(): void;
}) {
  return (
    <>
      <view className="h-[57px] flex flex-row items-center justify-between py-0 px-[25px] border-b border-solid border-[#272c32] shrink-0">
        <view className="flex flex-row items-center gap-[12px]">
          <text
            className="text-[16px] font-bold text-[color:var(--workspace-color)]"
            style={`--workspace-color: ${workspace?.color ?? '#a8e6cf'}`}
          >
            {workspace?.icon ?? '>_'}
          </text>
          <text id="active-workspace" className="text-[13px] font-bold text-[#d8dee5]">
            {workspace?.name ?? 'Workspaces'}
          </text>
          <text className="text-[14px] text-[#515c6a]">/</text>
          <text className="text-[12px] text-[#8993a1]">
            {tabCount} {tabCount === 1 ? 'tab' : 'tabs'}
          </text>
        </view>
        <view
          id="edit-workspace"
          className="py-[8px] px-[12px] border border-solid border-[#323a43] rounded-[7px]"
          bindtap={onSettings}
        >
          <text className="text-[11px] text-[#adb7c4]">Configure workspace</text>
        </view>
      </view>

      <view className="flex-1 min-h-0 flex flex-col bg-[#111419] m-[16px] border border-solid border-[#272d35] rounded-[12px] overflow-hidden">
        {error ? (
          <view className="flex-1 flex flex-col items-center justify-center py-[18px] px-[30px]">
            <text className="text-[27px] font-medium text-[#dce3e7] text-center mb-[12px]">
              Could not load workspaces
            </text>
            <text
              id="config-error"
              className="text-[11px] text-[#e4a4a4] leading-[18px] mt-[12px] break-all"
            >
              {error}
            </text>
            <view
              id="retry-config"
              className="py-[10px] px-[16px] rounded-[7px] bg-[#a8e6cf] mt-[15px]"
              bindtap={onRetry}
            >
              <text className="text-[12px] font-bold text-[#20392f]">Try again</text>
            </view>
          </view>
        ) : null}
        <>
          <view
            className={
              error
                ? 'hidden'
                : 'h-[55px] py-0 px-[24px] flex flex-row items-center justify-between shrink-0'
            }
          >
            <view className="flex flex-row items-center gap-[10px] flex-1 min-w-0">
              <text className="text-[18px] text-[#778b86]">~</text>
              <text
                id="session-directory"
                className="text-[11px] text-[#76818e] overflow-hidden text-ellipsis whitespace-nowrap"
              >
                {activeTab
                  ? activeTab.kind === 'sftp'
                    ? 'SFTP file browser'
                    : activeTab.profile.type === 'ssh'
                      ? `SSH · ${activeTab.profile.host}`
                      : activeTab.profile.command
                  : 'Choose a workspace'}
              </text>
            </view>
            <text id="session-label" className="text-[9px] text-[#65717f] tracking-[1px] ml-[12px]">
              {activeTab ? `SESSION ${String(activeTab.number).padStart(2, '0')}` : 'NO SESSION'}
            </text>
          </view>
          {children}
          {!error && (!children || !activeTab) ? (
            <view className="flex-1 flex flex-col items-center justify-center p-[24px]">
              <text id="terminal-placeholder" className="text-[18px] text-[#7c8998]">
                {loading ? 'Getting things ready.' : 'Open a terminal tab in this workspace.'}
              </text>
              {!loading && !activeTab ? (
                <view
                  id="start-terminal"
                  className="p-[12px] rounded-[7px] bg-[#a8e6cf] mt-[15px]"
                  bindtap={onAdd}
                >
                  <text className="text-[12px] text-[#20392f]">+ New terminal</text>
                </view>
              ) : null}
            </view>
          ) : null}
          <view
            className={
              error ? 'hidden' : 'py-[17px] px-[24px] flex flex-row justify-between shrink-0'
            }
          >
            <text className="text-[9px] text-[#596574]">
              {workspace?.name ?? 'Catus'} ·{' '}
              {activeTab ? `Tab ${activeTab.number}` : 'No open tabs'}
            </text>
            <text className="text-[9px] text-[#596574]">
              {activeTab?.kind === 'sftp' ? 'SFTP' : workspace?.type === 'ssh' ? 'SSH' : 'Local'}
            </text>
          </view>
        </>
      </view>
    </>
  );
}
