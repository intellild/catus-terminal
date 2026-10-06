import { cn } from '../lib/utils';
import 'background-only';
import '../runtime';
import { useAtomSet, useAtomValue, useAtomRefresh } from '@effect/atom-react';
import { shellHostAtom, shellOptionsAtom, shellsAtom } from './shells';
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
import { WorkspaceContextMenu } from '../components/WorkspaceContextMenu';
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
  const { view, load } = session;
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
          onAdd={session.addWorkspace}
          activeWorkspaceId={view.workspace?.id}
          runningIds={view.runningIds}
          loading={load.loading}
          onSelect={session.openWorkspace}
          onContextMenu={session.openWorkspaceMenu}
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
                className={cn(
                  !load.error && view.activeTab?.id === tab.id
                    ? 'flex-1 min-h-0 flex flex-col'
                    : 'hidden',
                )}
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
      return <WorkspaceSettingsRegion session={session} host={host} />;
  }
}

function WorkspaceSettingsRegion({
  session,
  host,
}: {
  session: ReturnType<typeof useWorkspaceSession>;
  host?: WorkspaceHost;
}) {
  const setHost = useAtomSet(shellHostAtom);
  useEffect(() => {
    setHost(host?.listShells ? { listShells: host.listShells.bind(host) } : undefined);
  }, [host, setHost]);
  const shells = useAtomValue(shellOptionsAtom);
  const retry = useAtomRefresh(shellsAtom);
  const { editor, view } = session;
  return (
    <>
      <WorkspaceContextMenu
        menu={session.workspaceMenu}
        canDelete={view.workspaces.length > 1}
        busy={editor.saving}
        error={editor.error}
        onClose={session.closeWorkspaceMenu}
        onEdit={session.openSettings}
        onDelete={session.deleteWorkspace}
      />
      <WorkspaceSettings
        editor={editor}
        shells={shells}
        onRetryShells={retry}
        configPath={view.state.payload?.path}
        environment={view.state.payload?.environment}
        onClose={session.closeSettings}
        onChange={session.updateDraft}
        onSave={session.saveDraft}
      />
    </>
  );
}
