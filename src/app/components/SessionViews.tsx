import 'background-only';
import '../runtime';
import { useAtomSet, useAtomValue } from '@effect/atom-react';
import { sessionActionsAtom } from '../state/sessionActions';
import { tabsViewAtom, workspacesViewAtom, statusViewAtom } from '../state/sessionViews';
import { TabList } from './TabBar';
import { TabActions } from './TabBar/TabActions';
import { TabItem } from './TabBar/TabItem';
import { WorkspaceItem } from './Workspace/WorkspaceItem';
import { WorkspaceList } from './Workspace/WorkspaceList';
import { StatusBar } from './StatusBar';
import { tmuxSessionsViewAtom } from '../state/tmux';
import { closeTmuxSessionAtom, refreshTmuxSessionsAtom } from '../state/tmuxSessions';
import { SettingsButton } from './Settings/SettingsButton';

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

export function SessionWorkspaces() {
  const view = useAtomValue(workspacesViewAtom);
  return (
    <WorkspaceList loading={view.loading && !view.workspaceIds.length} action={<SettingsButton />}>
      {view.workspaceIds.map((id) => (
        <WorkspaceItem key={id} id={id} />
      ))}
    </WorkspaceList>
  );
}

export function SessionStatus() {
  const view = useAtomValue(statusViewAtom);
  return <StatusBar {...view} />;
}

export { SessionContent } from './Terminal/SessionContent';
