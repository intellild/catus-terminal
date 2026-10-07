import 'background-only';
import '../runtime';
import { useAtomSet, useAtomValue } from '@effect/atom-react';
import { sessionActionsAtom } from '../state/sessionActions';
import { shellOptionsAtom } from '../state/shells';
import {
  tabsViewAtom,
  workspacesViewAtom,
  statusViewAtom,
  settingsViewAtom,
} from '../state/sessionViews';
import { TabList, TabActions } from './TabBar';
import { TabItem } from './TabBar/TabItem';
import { WorkspaceItem } from './Workspace/WorkspaceItem';
import { WorkspaceList } from './Workspace/WorkspaceList';
import { StatusBar } from './StatusBar';
import { WorkspaceSettings } from './Workspace/WorkspaceSettings';
import { WorkspaceContextMenu } from './Workspace/WorkspaceContextMenu';

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
  const dispatch = useAtomSet(sessionActionsAtom);
  return (
    <WorkspaceList
      loading={view.loading && !view.workspaceIds.length}
      onAdd={() => {
        'background only';
        dispatch({ type: 'addWorkspace' });
      }}
    >
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

export function SessionSettings() {
  const view = useAtomValue(settingsViewAtom);
  const shells = useAtomValue(shellOptionsAtom);
  const dispatch = useAtomSet(sessionActionsAtom);
  return (
    <>
      <WorkspaceContextMenu
        menu={view.menu}
        canDelete={view.canDelete}
        busy={view.editor.saving}
        error={view.editor.error}
        onClose={() => {
          'background only';
          dispatch({ type: 'closeMenu' });
        }}
        onEdit={(id) => {
          'background only';
          dispatch({ type: 'editWorkspace', id });
        }}
        onDelete={(id) => {
          'background only';
          dispatch({ type: 'deleteWorkspace', id });
        }}
      />
      <WorkspaceSettings
        editor={view.editor}
        shells={shells}
        configPath={view.configPath}
        environment={view.environment}
        onRetryShells={() => {
          'background only';
          dispatch({ type: 'retryShells' });
        }}
        onClose={() => {
          'background only';
          dispatch({ type: 'closeSettings' });
        }}
        onChange={(field, value) => {
          'background only';
          dispatch({ type: 'updateDraft', field, value });
        }}
        onSave={() => {
          'background only';
          dispatch({ type: 'saveDraft' });
        }}
      />
    </>
  );
}

export { SessionContent } from './Terminal/SessionContent';
