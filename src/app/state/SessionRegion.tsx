import 'background-only';
import '../runtime';
import { useCallback, useEffect } from '@lynx-js/react';
import { RegistryContext } from '@effect/atom-react';
import { sessionRegistry } from './sessionRegistry';
import type { WorkspaceHost } from '../../shared/workspaces';
import { TabBar } from '../components/TabBar';
import { WorkspaceList } from '../components/WorkspaceList';
import { SftpBrowser } from '../components/SftpBrowser';
import { TerminalView } from '../components/TerminalView';
import { TerminalContent } from '../components/TerminalContent';
import { StatusBar } from '../components/StatusBar';
import { WorkspaceSettings } from '../components/WorkspaceSettings';
import { useLoadWorkspaces, useWorkspaceSession } from './useWorkspaceSession';

type Region = 'bootstrap' | 'workspaces' | 'tabs' | 'content' | 'status' | 'settings';

export function SessionRegion({ region, host }: { region: Region; host?: WorkspaceHost }) {
  return (
    <RegistryContext.Provider value={sessionRegistry}>
      {region === 'bootstrap' ? (
        <SessionLoader host={host} />
      ) : (
        <RegionContent region={region} host={host} />
      )}
    </RegistryContext.Provider>
  );
}

function SessionLoader({ host }: { host?: WorkspaceHost }) {
  useLoadWorkspaces(host);
  return null;
}

function RegionContent({
  region,
  host,
}: {
  region: Exclude<Region, 'bootstrap'>;
  host?: WorkspaceHost;
}) {
  const session = useWorkspaceSession(host);
  const { view, load, editor } = session;
  const activeNumber = view.activeTab?.number;
  const revealActiveTab = useCallback(() => {
    if (region !== 'tabs' || activeNumber === undefined) return;
    lynx
      .createSelectorQuery()
      .select(`#tab-item-${activeNumber}`)
      .invoke({
        method: 'scrollIntoView',
        params: { scrollIntoViewOptions: { block: 'center', inline: 'center', behavior: 'none' } },
      })
      .exec();
  }, [region, activeNumber]);
  useEffect(revealActiveTab, [revealActiveTab]);
  switch (region) {
    case 'tabs':
      return (
        <TabBar
          tabs={view.tabs}
          activeTabId={view.activeTab?.id}
          loading={load.loading}
          onSelect={session.focusTab}
          onClose={session.removeTab}
          onAdd={session.addTab}
          onAddSftp={view.workspace?.type === 'ssh' ? session.addSftpTab : undefined}
          onLayout={revealActiveTab}
        />
      );
    case 'workspaces':
      return (
        <WorkspaceList
          workspaces={view.workspaces}
          activeWorkspaceId={view.workspace?.id}
          runningIds={view.runningIds}
          loading={load.loading}
          onSelect={session.openWorkspace}
          onSettings={session.openSettings}
        />
      );
    case 'content':
      return (
        <TerminalContent
          workspace={view.workspace}
          activeTab={view.activeTab}
          tabCount={view.tabs.length}
          loading={load.loading}
          error={load.error}
          onSettings={session.openSettings}
          onRetry={session.loadConfig}
          onAdd={session.addTab}
        >
          <TerminalView
            id={load.error || view.activeTab?.kind === 'sftp' ? undefined : view.activeTab?.id}
            sessionId={load.error ? 0 : view.terminalId}
            error={view.terminalError}
          />
          {view.state.tabs
            .filter((tab) => tab.kind === 'sftp')
            .map((tab) => (
              <view
                key={tab.id}
                className={
                  !load.error && view.activeTab?.id === tab.id
                    ? 'flex-1 min-h-0 flex flex-col'
                    : 'hidden'
                }
              >
                <SftpBrowser id={tab.id} host={tab.profile.host!} />
              </view>
            ))}
        </TerminalContent>
      );
    case 'status':
      return (
        <StatusBar
          workspaceCount={view.runningIds.size}
          tabCount={view.state.tabs.length}
          hasSession={!!view.activeTab}
        />
      );
    case 'settings':
      return (
        <WorkspaceSettings
          editor={editor}
          workspaces={view.workspaces}
          configPath={view.state.payload?.path}
          environment={view.state.payload?.environment}
          onClose={session.closeSettings}
          onSelect={session.selectProfile}
          onAdd={session.addWorkspace}
          onChange={session.updateDraft}
          onSave={session.saveDraft}
          onDelete={session.deleteWorkspace}
        />
      );
  }
}
