import { useTranslation } from '../../i18n';
import { PanelFooter } from '../ui/panel';
import type { WorkspaceSettings } from '../../../shared/workspaces';
import type { TerminalTab } from '../../state/session';

/** Shared footer for the terminal, tmux, SFTP and placeholder panels. */
export function SessionPanelFooter({
  workspace,
  tab,
}: {
  workspace?: WorkspaceSettings;
  tab?: TerminalTab;
}) {
  const { t } = useTranslation();
  return (
    <PanelFooter>
      <text className="text-[10px] text-[#596574]">
        {t('terminal.summary', {
          name: workspace?.name ?? 'Catus',
          tab: tab ? t('terminal.tab', { number: tab.number }) : t('tabs.empty'),
        })}
      </text>
      <text className="text-[10px] text-[#596574]">
        {t(
          tab?.kind === 'sftp'
            ? 'common.sftp'
            : tab?.kind === 'tmux'
              ? 'common.tmux'
              : workspace?.type === 'ssh'
                ? 'common.ssh'
                : 'common.local',
        )}
      </text>
    </PanelFooter>
  );
}
