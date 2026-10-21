import { useTranslation } from '../../i18n';
import { PanelFooter } from '../ui/panel';
import type { HostProfile } from '../../../shared/hosts';
import type { TerminalTab } from '../../state/session';

/** Shared footer for the terminal, tmux, SFTP and placeholder panels. */
export function SessionPanelFooter({ host, tab }: { host?: HostProfile; tab?: TerminalTab }) {
  const { t } = useTranslation();
  return (
    <PanelFooter>
      <text className="text-[10px] text-[#596574]">
        {t('terminal.summary', {
          name: host?.name ?? 'Catus',
          tab: tab ? t('terminal.tab', { number: tab.number }) : t('tabs.empty'),
        })}
      </text>
      <text className="text-[10px] text-[#596574]">
        {t(
          tab?.kind === 'sftp'
            ? 'common.sftp'
            : tab?.kind === 'tmux'
              ? 'common.tmux'
              : host?.type === 'ssh'
                ? 'common.ssh'
                : 'common.local',
        )}
      </text>
    </PanelFooter>
  );
}
