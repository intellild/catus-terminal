import { useTranslation } from '../../i18n';
import type { WorkspaceSettings } from '../../../shared/workspaces';
import { Button } from '../ui/button';
import { Icon } from '../ui/icon';
import { Panel, PanelActions, PanelContent, PanelHeader, PanelTitle } from '../ui/panel';
import { SessionPanelFooter } from './session-panel-footer';

/** Loading, empty and configuration-error states use the same panel shell. */
export function PanelPlaceholder({
  workspace,
  loading = false,
  error = '',
  onRetry,
  onAdd,
}: {
  workspace?: WorkspaceSettings;
  loading?: boolean;
  error?: string;
  onRetry?(): void;
  onAdd?(): void;
}) {
  const { t } = useTranslation();
  if (error) {
    return (
      <Panel>
        <PanelContent className="items-center justify-center py-[18px] px-[30px]">
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
        </PanelContent>
      </Panel>
    );
  }
  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>
          <text className="text-[14px] text-[#778b86]">~</text>
          <text
            data-automation-id="session-directory"
            className="text-[11px] text-[#76818e] overflow-hidden text-ellipsis whitespace-nowrap"
          >
            {t('terminal.chooseWorkspace')}
          </text>
        </PanelTitle>
        <PanelActions>
          <text
            data-automation-id="session-label"
            className="text-[10px] text-[#65717f] tracking-[1px]"
          >
            {t('terminal.noSession')}
          </text>
        </PanelActions>
      </PanelHeader>
      <PanelContent className="items-center justify-center p-[24px]">
        <text data-automation-id="terminal-placeholder" className="text-[18px] text-[#7c8998]">
          {t(loading ? 'terminal.loading' : 'terminal.empty')}
        </text>
        {!loading ? (
          <Button
            data-automation-id="start-terminal"
            className="h-auto p-[12px] rounded-[7px] mt-[15px] font-normal"
            bindtap={onAdd}
          >
            <Icon name="plus" size={14} color="#20392f" />
            <text className="text-[12px] text-[#20392f]">{t('terminal.new')}</text>
          </Button>
        ) : null}
      </PanelContent>
      <SessionPanelFooter workspace={workspace} />
    </Panel>
  );
}
