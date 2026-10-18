import 'background-only';
import '../runtime';
import { useAtomSet, useAtomValue } from '@effect/atom-react';
import { sessionActionsAtom } from '../state/sessionActions';
import { tabsViewAtom, workspacesViewAtom, statusViewAtom } from '../state/sessionViews';
import { TabList, TabActions } from './TabBar';
import { TabItem } from './TabBar/TabItem';
import { WorkspaceItem } from './Workspace/WorkspaceItem';
import { WorkspaceList } from './Workspace/WorkspaceList';
import { StatusBar } from './StatusBar';
import { WorkspaceAdd } from './Workspace/WorkspaceAdd';

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
  const dispatch = useAtomSet(sessionActionsAtom);
  return (
    <TabActions
      onAdd={() => {
        'background only';
        dispatch({ type: 'addTab' });
      }}
      onAddSftp={
        view.ssh
          ? () => {
              'background only';
              dispatch({ type: 'addSftpTab' });
            }
          : undefined
      }
    />
  );
}

export function SessionWorkspaces() {
  const view = useAtomValue(workspacesViewAtom);
  return (
    <WorkspaceList loading={view.loading && !view.workspaceIds.length} action={<WorkspaceAdd />}>
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
