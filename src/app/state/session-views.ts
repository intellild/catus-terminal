import 'background-only';
import * as Atom from 'effect/reactivity/Atom';
import type { TerminalTab } from './session';
import type { TabKind } from '../../shared/tabs';
import type { HostProfile } from '../../shared/hosts';
import { languageAtom, settingsAtom } from './settings';
import {
  editorAtom,
  loadAtom,
  sessionAtom,
  sessionViewAtom,
  activeHostAtom,
  activeHostIdAtom,
  hostAtom,
  hostIdsAtom,
  hostProfilesAtom,
  tabAtom,
  allTabsAtom,
} from './session';

const payloadAtom = Atom.make((get) => get(sessionAtom).payload);

export const tabsViewAtom = Atom.make((get) => {
  const host = get(activeHostAtom);
  return {
    tabIds: host?.tabIds ?? [],
    ssh: host?.profile.type === 'ssh',
    defaultTab: host?.profile.defaultTab ?? ('shell' satisfies TabKind),
    loading: get(loadAtom).loading,
  };
}).pipe(
  Atom.withEquality<{
    tabIds: readonly number[];
    ssh: boolean;
    defaultTab: TabKind;
    loading: boolean;
  }>(
    (a, b) =>
      a.ssh === b.ssh &&
      a.defaultTab === b.defaultTab &&
      a.loading === b.loading &&
      a.tabIds.length === b.tabIds.length &&
      a.tabIds.every((id, index) => id === b.tabIds[index]),
  ),
);

export const tabViewAtom = Atom.family((id: number) =>
  Atom.make((get) => {
    const tab = get(tabAtom(id));
    const host = tab ? get(hostAtom(tab.hostId)) : undefined;
    return {
      tab,
      active: !!tab && get(activeHostIdAtom) === tab.hostId && host?.activeTabId === id,
    };
  }).pipe(
    Atom.withEquality<{ tab: TerminalTab | undefined; active: boolean }>(
      (a, b) => a.tab === b.tab && a.active === b.active,
    ),
  ),
);

export const hostViewAtom = Atom.family((id: string) =>
  Atom.make((get) => {
    const state = get(hostAtom(id));
    return {
      host: state?.profile,
      active: get(activeHostIdAtom) === id,
      running: !!state?.tabIds.length,
    };
  }).pipe(
    Atom.withEquality<{
      host: HostProfile | undefined;
      active: boolean;
      running: boolean;
    }>((a, b) => a.host === b.host && a.active === b.active && a.running === b.running),
  ),
);
export const hostsViewAtom = Atom.make((get) => ({
  hostIds: get(hostIdsAtom),
  loading: get(loadAtom).loading,
})).pipe(
  Atom.withEquality<{ hostIds: readonly string[]; loading: boolean }>(
    (a, b) => a.hostIds === b.hostIds && a.loading === b.loading,
  ),
);
export const contentViewAtom = Atom.make((get) => {
  const { host, activeTab, tabs, terminalId, terminalError } = get(sessionViewAtom);
  const load = get(loadAtom);
  return {
    host,
    activeTab,
    tabCount: tabs.length,
    sftpTabs: get(allTabsAtom).filter((tab) => tab.kind === 'sftp'),
    terminalId,
    terminalError,
    ...load,
  };
});
export const statusViewAtom = Atom.make((get) => {
  const { runningIds, activeTab } = get(sessionViewAtom);
  return {
    hostCount: runningIds.size,
    tabCount: get(allTabsAtom).length,
    hasSession: !!activeTab,
  };
});
export const settingsViewAtom = Atom.make((get) => {
  const payload = get(payloadAtom);
  const settings = get(settingsAtom);
  return {
    open: settings.open,
    section: settings.section,
    editor: get(editorAtom),
    hosts: get(hostProfilesAtom),
    canDelete: get(sessionAtom).hostIds.length > 1,
    configPath: payload?.path,
    environment: payload?.environment,
    language: get(languageAtom),
  };
});
