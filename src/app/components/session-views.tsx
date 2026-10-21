import 'background-only';
import '../runtime';
import { useAtomSet, useAtomValue } from '@effect/atom-react';
import { sessionActionsAtom } from '../state/session-actions';
import { tabsViewAtom, hostsViewAtom, statusViewAtom } from '../state/session-views';
import { TabList } from './tab-bar';
import { TabActions } from './tab-bar/tab-actions';
import { TabItem } from './tab-bar/tab-item';
import { HostItem } from './host/host-item';
import { HostList } from './host/host-list';
import { StatusBar } from './status-bar';
import { tmuxSessionsViewAtom } from '../state/tmux';
import { closeTmuxSessionAtom, refreshTmuxSessionsAtom } from '../state/tmux-sessions';
import { SettingsButton } from './settings/settings-button';

export function SessionTabs() {
  const view = useAtomValue(tabsViewAtom);
  return (
    <TabList tabCount={view.tabIds.length} loading={view.loading}>
      {view.tabIds.map((id) => (
        <TabItem key={id} id={id} />
      ))}
    </TabList>
  );
}

export function SessionTabActions() {
  const view = useAtomValue(tabsViewAtom);
  const tmux = useAtomValue(tmuxSessionsViewAtom);
  const dispatch = useAtomSet(sessionActionsAtom);
  const closeTmux = useAtomSet(closeTmuxSessionAtom);
  const refreshTmux = useAtomSet(refreshTmuxSessionsAtom);
  return (
    <TabActions
      defaultKind={view.defaultTab}
      ssh={view.ssh}
      onAdd={(kind) => {
        'background only';
        dispatch({ type: 'addTab', kind });
      }}
      tmux={{
        sessions: tmux.sessions,
        onOpen: () => {
          'background only';
          refreshTmux(tmux.destination);
        },
        onAttach: (session) => {
          'background only';
          dispatch({ type: 'attachTmux', session });
        },
        onNew: () => {
          'background only';
          dispatch({ type: 'newTmuxSession' });
        },
        onClose: (session) => {
          'background only';
          closeTmux({ destination: tmux.destination, session });
        },
      }}
    />
  );
}

export function SessionHosts() {
  const view = useAtomValue(hostsViewAtom);
  return (
    <HostList loading={view.loading && !view.hostIds.length} action={<SettingsButton />}>
      {view.hostIds.map((id) => (
        <HostItem key={id} id={id} />
      ))}
    </HostList>
  );
}

export function SessionStatus() {
  const view = useAtomValue(statusViewAtom);
  return <StatusBar {...view} />;
}

export { SessionContent } from './terminal/session-content';
