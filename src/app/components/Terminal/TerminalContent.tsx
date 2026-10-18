import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { useTranslation } from '../../i18n';
import type { ReactNode } from '@lynx-js/react';
import type { WorkspaceSettings } from '../../../shared/workspaces';
import type { TerminalTab } from '../../state/session';

export function TerminalContent({
  workspace,
  activeTab,
  loading = false,
  error = '',
  children,
  onRetry,
  onAdd,
}: {
  children?: ReactNode;
  workspace?: WorkspaceSettings;
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
      <view className="flex-1 min-h-0 flex flex-col bg-[#111419] border border-solid border-[#272d35] overflow-hidden">
        {error ? (
          <view className="flex-1 flex flex-col items-center justify-center py-[18px] px-[30px]">
            <text className="text-[22px] font-medium text-[#dce3e7] text-center mb-[12px]">
              {t('terminal.loadError')}
            </text>
            <text
              data-automation-id="config-error"
              className="text-[11px] text-[#e4a4a4] leading-[18px] mt-[12px] break-all"
            >
              {error}
            </text>
            <Button
              data-automation-id="retry-config"
              className="h-auto py-[10px] rounded-[7px] mt-[15px]"
              bindtap={onRetry}
            >
              <text className="text-[12px] font-bold text-[#20392f]">{t('terminal.retry')}</text>
            </Button>
          </view>
        ) : null}
        <>
          {activeTab?.kind !== 'sftp' ? (
            <view
              className={
                error
                  ? 'hidden'
                  : 'h-[36px] py-0 px-[16px] flex flex-row items-center justify-between shrink-0'
              }
            >
              <view className="flex flex-row items-center gap-[8px] flex-1 min-w-0">
                <text className="text-[14px] text-[#778b86]">~</text>
                <text
                  data-automation-id="session-directory"
                  className="text-[11px] text-[#76818e] overflow-hidden text-ellipsis whitespace-nowrap"
                >
                  {activeTab
                    ? activeTab.profile.type === 'ssh'
                      ? t('terminal.sshHost', { host: activeTab.profile.host })
                      : activeTab.profile.command
                    : t('terminal.chooseWorkspace')}
                </text>
              </view>
              <text
                data-automation-id="session-label"
                className="text-[10px] text-[#65717f] tracking-[1px] ml-[12px]"
              >
                {activeTab
                  ? t('terminal.session', { number: String(activeTab.number).padStart(2, '0') })
                  : t('terminal.noSession')}
              </text>
            </view>
          ) : null}
          {children}
          {!error && (!children || !activeTab) ? (
            <view className="flex-1 flex flex-col items-center justify-center p-[24px]">
              <text
                data-automation-id="terminal-placeholder"
                className="text-[18px] text-[#7c8998]"
              >
                {t(loading ? 'terminal.loading' : 'terminal.empty')}
              </text>
              {!loading && !activeTab ? (
                <Button
                  data-automation-id="start-terminal"
                  className="h-auto p-[12px] rounded-[7px] mt-[15px] font-normal"
                  bindtap={onAdd}
                >
                  <Icon name="plus" size={14} color="#20392f" />
                  <text className="text-[12px] text-[#20392f]">{t('terminal.new')}</text>
                </Button>
              ) : null}
            </view>
          ) : null}
          <view
            className={
              error ? 'hidden' : 'py-[8px] px-[16px] flex flex-row justify-between shrink-0'
            }
          >
            <text className="text-[10px] text-[#596574]">
              {t('terminal.summary', {
                name: workspace?.name ?? 'Catus',
                tab: activeTab ? t('terminal.tab', { number: activeTab.number }) : t('tabs.empty'),
              })}
            </text>
            <text className="text-[10px] text-[#596574]">
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
