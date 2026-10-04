import 'background-only';
import '../runtime';
import { useCallback, useEffect } from '@lynx-js/react';
import { RegistryContext, scheduleTask } from '@effect/atom-react';
import * as AtomRegistry from 'effect/reactivity/AtomRegistry';
import type { WorkspaceHost } from '../../shared/workspaces';
import { TabBar } from '../components/TabBar';
import { WorkspaceList } from '../components/WorkspaceList';
import { TerminalView } from '../components/TerminalView';
import { TerminalContent } from '../components/TerminalContent';
import { StatusBar } from '../components/StatusBar';
import { WorkspaceSettings } from '../components/WorkspaceSettings';
import { useLoadWorkspaces, useWorkspaceSession } from './useWorkspaceSession';

// App creates only this empty scope on the main thread. Each background region
// attaches to the same registry without exposing Effect to the first-frame code.
export interface SessionScope {
  registry?: AtomRegistry.AtomRegistry;
  mounts?: number;
  disposeTimer?: ReturnType<typeof setTimeout>;
}
type Region = 'bootstrap' | 'workspaces' | 'tabs' | 'content' | 'status' | 'settings';

export function SessionRegion({
  scope,
  region,
  host,
}: {
  scope: SessionScope;
  region: Region;
  host?: WorkspaceHost;
}) {
  const registry = (scope.registry ??= AtomRegistry.make({ scheduleTask }));
  useEffect(() => {
    if (scope.disposeTimer !== undefined) clearTimeout(scope.disposeTimer);
    scope.mounts = (scope.mounts ?? 0) + 1;
    return () => {
      scope.mounts! -= 1;
      if (scope.mounts === 0) {
        scope.disposeTimer = setTimeout(() => {
          registry.dispose();
          scope.registry = undefined;
        }, 500);
      }
    };
  }, [scope, registry]);
  return (
    <RegistryContext.Provider value={registry}>
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
          <TerminalView tabs={view.state.tabs} id={load.error ? undefined : view.activeTab?.id} />
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
