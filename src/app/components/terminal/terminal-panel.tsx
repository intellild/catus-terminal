import { useTranslation } from '../../i18n';
import type { ReactNode } from '@lynx-js/react';
import type { WorkspaceSettings } from '../../../shared/workspaces';
import type { TerminalTab } from '../../state/session';
import { Panel, PanelActions, PanelContent, PanelHeader, PanelTitle } from '../ui/panel';
import { SessionPanelFooter } from './session-panel-footer';
import { TerminalView } from './terminal-view';

export interface TerminalPanelProps {
  id?: number;
  sessionId: number;
  tab?: TerminalTab;
  workspace?: WorkspaceSettings;
  terminalError: string;
  titleTabs?: ReactNode;
}

/** Panel for a shell/SSH terminal. TmuxPanel reuses it with tmux title tabs. */
export function TerminalPanel({
  id,
  sessionId,
  tab,
  workspace,
  terminalError,
  titleTabs,
}: TerminalPanelProps) {
  const { t } = useTranslation();
  return (
    <Panel>
      {tab ? (
        <PanelHeader>
          <PanelTitle>
            {titleTabs ?? (
              <>
                <text className="text-[14px] text-[#778b86]">~</text>
                <text
                  data-automation-id="session-directory"
                  className="text-[11px] text-[#76818e] overflow-hidden text-ellipsis whitespace-nowrap"
                >
                  {tab.profile.type === 'ssh'
                    ? t('terminal.sshHost', { host: tab.profile.host })
                    : tab.profile.command}
                </text>
              </>
            )}
          </PanelTitle>
          <PanelActions>
            <text
              data-automation-id="session-label"
              className="text-[10px] text-[#65717f] tracking-[1px]"
            >
              {t('terminal.session', { number: String(tab.number).padStart(2, '0') })}
            </text>
          </PanelActions>
        </PanelHeader>
      ) : null}
      <PanelContent>
        <TerminalView id={id} sessionId={sessionId} error={terminalError} />
      </PanelContent>
      {tab ? <SessionPanelFooter workspace={workspace} tab={tab} /> : null}
    </Panel>
  );
}
