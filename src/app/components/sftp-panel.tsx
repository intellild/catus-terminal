import type { HostProfile } from '../../shared/hosts';
import type { TerminalTab } from '../state/session';
import { Panel, PanelContent } from './ui/panel';
import { SftpBrowser } from './sftp-browser';
import { SessionPanelFooter } from './terminal/session-panel-footer';

/** SFTP panel: the browser owns its toolbar and breadcrumbs. */
export function SftpPanel({
  id,
  host,
  tab,
  profile,
}: {
  id: number;
  host: string;
  tab: TerminalTab;
  profile?: HostProfile;
}) {
  return (
    <Panel>
      <PanelContent>
        <SftpBrowser id={id} host={host} />
      </PanelContent>
      <SessionPanelFooter host={profile} tab={tab} />
    </Panel>
  );
}
