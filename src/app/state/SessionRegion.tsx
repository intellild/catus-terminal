import 'background-only';
import '../runtime';
import { RegistryContext, useAtomSet, useAtomValue } from '@effect/atom-react';
import { useCallback, useEffect } from '@lynx-js/react';
import { cn } from '../lib/utils';
import { sessionRegistry } from './sessionRegistry';
import { sessionActionsAtom } from './sessionActions';
import { shellOptionsAtom } from './shells';
import {
  tabsViewAtom,
  workspacesViewAtom,
  contentViewAtom,
  statusViewAtom,
  settingsViewAtom,
} from './sessionViews';
import { TabBar } from '../components/TabBar';
import { WorkspaceList } from '../components/WorkspaceList';
import { SftpBrowser } from '../components/SftpBrowser';
import { TerminalView } from '../components/TerminalView';
import { TerminalContent } from '../components/TerminalContent';
import { StatusBar } from '../components/StatusBar';
import { WorkspaceSettings } from '../components/WorkspaceSettings';
import { WorkspaceContextMenu } from '../components/WorkspaceContextMenu';

type Region = 'workspaces' | 'tabs' | 'content' | 'status' | 'settings';

const regions = {
  tabs: SessionTabs,
  workspaces: SessionWorkspaces,
  content: SessionContent,
  status: SessionStatus,
  settings: SessionSettings,
};

// This boundary only connects UI subscriptions to the application registry.
export function SessionRegion({ region }: { region: Region }) {
  const Content = regions[region];
  return (
    <RegistryContext.Provider value={sessionRegistry}>
      <Content />
    </RegistryContext.Provider>
  );
}

function SessionTabs() {
  const view = useAtomValue(tabsViewAtom);
  const dispatch = useAtomSet(sessionActionsAtom);
  const revealActiveTab = useCallback(() => {
    'background only';
    if (view.activeNumber === undefined) return;
    lynx
      .createSelectorQuery()
      .select(`#tab-item-${view.activeNumber}`)
      .invoke({
        method: 'scrollIntoView',
        params: { scrollIntoViewOptions: { block: 'center', inline: 'center', behavior: 'none' } },
      })
      .exec();
  }, [view.activeNumber]);
  useEffect(revealActiveTab, [revealActiveTab]);
  return (
    <TabBar
      tabs={view.tabs}
      activeTabId={view.activeTabId}
      loading={view.loading}
      onSelect={(id) => {
        'background only';
        dispatch({ type: 'focusTab', id });
      }}
      onClose={(id) => {
        'background only';
        dispatch({ type: 'closeTab', id });
      }}
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
      onLayout={revealActiveTab}
    />
  );
}

function SessionWorkspaces() {
  const view = useAtomValue(workspacesViewAtom);
  const dispatch = useAtomSet(sessionActionsAtom);
  return (
    <WorkspaceList
      {...view}
      onAdd={() => {
        'background only';
        dispatch({ type: 'addWorkspace' });
      }}
      onSelect={(id) => {
        'background only';
        dispatch({ type: 'openWorkspace', id });
      }}
      onContextMenu={(id, x, y) => {
        'background only';
        dispatch({ type: 'openMenu', id, x, y });
      }}
    />
  );
}

function SessionContent() {
  const view = useAtomValue(contentViewAtom);
  const dispatch = useAtomSet(sessionActionsAtom);
  return (
    <TerminalContent
      workspace={view.workspace}
      activeTab={view.activeTab}
      tabCount={view.tabCount}
      loading={view.loading}
      error={view.error}
      onRetry={() => {
        'background only';
        dispatch({ type: 'reload' });
      }}
      onAdd={() => {
        'background only';
        dispatch({ type: 'addTab' });
      }}
    >
      <TerminalView
        id={view.error || view.activeTab?.kind === 'sftp' ? undefined : view.activeTab?.id}
        sessionId={view.error ? 0 : view.terminalId}
        error={view.terminalError}
      />
      {view.sftpTabs.map((tab) => (
        <view
          key={tab.id}
          className={cn(
            !view.error && view.activeTab?.id === tab.id
              ? 'flex-1 min-h-0 flex flex-col'
              : 'hidden',
          )}
        >
          <SftpBrowser id={tab.id} host={tab.profile.host!} />
        </view>
      ))}
    </TerminalContent>
  );
}

function SessionStatus() {
  const view = useAtomValue(statusViewAtom);
  return <StatusBar {...view} />;
}

function SessionSettings() {
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
