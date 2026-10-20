import type { WorkspaceSettings } from '../../shared/workspaces';
import type { TerminalTab } from '../state/session';
import { Panel, PanelContent } from './ui/Panel';
import { SftpBrowser } from './SftpBrowser';
import { SessionPanelFooter } from './Terminal/SessionPanelFooter';

/** SFTP panel: the browser owns its toolbar and breadcrumbs. */
export function SftpPanel({
  id,
  host,
  tab,
  workspace,
}: {
  id: number;
  host: string;
  tab: TerminalTab;
  workspace?: WorkspaceSettings;
}) {
  return (
    <Panel>
      <PanelContent>
        <SftpBrowser id={id} host={host} />
      </PanelContent>
      <SessionPanelFooter workspace={workspace} tab={tab} />
    </Panel>
  );
}
