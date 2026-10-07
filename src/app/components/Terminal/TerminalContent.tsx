import { Button } from '../ui/Button';
import { useTranslation } from '../../i18n';
import type { ReactNode } from '@lynx-js/react';
import type { Workspace } from '../../../shared/workspaces';
import type { TerminalTab } from '../../state/session';

export function TerminalContent({
  workspace,
  activeTab,
  tabCount = 0,
  loading = false,
  error = '',
  children,
  onRetry,
  onAdd,
}: {
  children?: ReactNode;
  workspace?: Workspace;
  activeTab?: TerminalTab;
  tabCount?: number;
  loading?: boolean;
  error?: string;
  onRetry?(): void;
  onAdd?(): void;
}) {
  const { t } = useTranslation();
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
            {workspace?.name ?? t('terminal.workspaces')}
          </text>
          <text className="text-[14px] text-[#515c6a]">/</text>
          <text className="text-[12px] text-[#8993a1]">{t('tabs.count', { count: tabCount })}</text>
        </view>
      </view>

      <view className="flex-1 min-h-0 flex flex-col bg-[#111419] m-[16px] border border-solid border-[#272d35] rounded-[12px] overflow-hidden">
        {error ? (
          <view className="flex-1 flex flex-col items-center justify-center py-[18px] px-[30px]">
            <text className="text-[27px] font-medium text-[#dce3e7] text-center mb-[12px]">
              {t('terminal.loadError')}
            </text>
            <text
              id="config-error"
              className="text-[11px] text-[#e4a4a4] leading-[18px] mt-[12px] break-all"
            >
              {error}
            </text>
            <Button
              id="retry-config"
              className="h-auto py-[10px] rounded-[7px] mt-[15px]"
              bindtap={onRetry}
            >
              <text className="text-[12px] font-bold text-[#20392f]">{t('terminal.retry')}</text>
            </Button>
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
                    ? t('terminal.sftpBrowser')
                    : activeTab.profile.type === 'ssh'
                      ? t('terminal.sshHost', { host: activeTab.profile.host })
                      : activeTab.profile.command
                  : t('terminal.chooseWorkspace')}
              </text>
            </view>
            <text id="session-label" className="text-[9px] text-[#65717f] tracking-[1px] ml-[12px]">
              {activeTab
                ? t('terminal.session', { number: String(activeTab.number).padStart(2, '0') })
                : t('terminal.noSession')}
            </text>
          </view>
          {children}
          {!error && (!children || !activeTab) ? (
            <view className="flex-1 flex flex-col items-center justify-center p-[24px]">
              <text id="terminal-placeholder" className="text-[18px] text-[#7c8998]">
                {t(loading ? 'terminal.loading' : 'terminal.empty')}
              </text>
              {!loading && !activeTab ? (
                <Button
                  id="start-terminal"
                  className="h-auto p-[12px] rounded-[7px] mt-[15px] font-normal"
                  bindtap={onAdd}
                >
                  <text className="text-[12px] text-[#20392f]">{t('terminal.new')}</text>
                </Button>
              ) : null}
            </view>
          ) : null}
          <view
            className={
              error ? 'hidden' : 'py-[17px] px-[24px] flex flex-row justify-between shrink-0'
            }
          >
            <text className="text-[9px] text-[#596574]">
              {t('terminal.summary', {
                name: workspace?.name ?? 'Catus',
                tab: activeTab ? t('terminal.tab', { number: activeTab.number }) : t('tabs.empty'),
              })}
            </text>
            <text className="text-[9px] text-[#596574]">
              {t(
                activeTab?.kind === 'sftp'
                  ? 'common.sftp'
                  : workspace?.type === 'ssh'
                    ? 'common.ssh'
                    : 'common.local',
              )}
            </text>
          </view>
        </>
      </view>
    </>
  );
}
