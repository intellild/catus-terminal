import { useState } from '@lynx-js/react';
import type { WorkspaceHost } from '../shared/workspaces';
import {
  AppLayout,
  AppLayoutBody,
  AppLayoutContent,
  AppLayoutFooter,
  AppLayoutHeader,
  AppLayoutHeaderContent,
  AppLayoutMain,
  AppLayoutSidebar,
} from './components/AppLayout';
import { TabBar } from './components/TabBar';
import { WorkspaceList } from './components/WorkspaceList';
import { TerminalContent } from './components/TerminalContent';
import { StatusBar } from './components/StatusBar';
import { SessionRegion } from './state/SessionRegion';
import type { SessionScope } from './state/SessionRegion';
import './App.css';

export function App({ host }: { host?: WorkspaceHost }) {
  const [scope] = useState<SessionScope>({});
  return <AppLayout>
    <AppLayoutHeader>
      <view id="window-controls-space" className="WindowControlsSpace" />
      <AppLayoutHeaderContent>
        <background-only fallback={<TabBar loading />}>
          <SessionRegion scope={scope} region="tabs" host={host} />
        </background-only>
        <view className="ChromeDragSpace" />
        <view className="ChromeDivider" />
        <text className="ChromeLabel">Catus Terminal</text>
      </AppLayoutHeaderContent>
    </AppLayoutHeader>
    <AppLayoutBody>
      <AppLayoutSidebar>
        <view className="BrandMark"><text className="BrandLetter">c</text></view>
        <view className="DockSeparator" />
        <background-only fallback={<WorkspaceList loading />}>
          <SessionRegion scope={scope} region="workspaces" host={host} />
        </background-only>
        <text className="DockCaption">CATUS</text>
      </AppLayoutSidebar>
      <AppLayoutMain>
        <AppLayoutContent>
          <background-only fallback={<TerminalContent loading />}>
            <SessionRegion scope={scope} region="content" host={host} />
          </background-only>
        </AppLayoutContent>
        <AppLayoutFooter>
          <background-only fallback={<StatusBar />}>
            <SessionRegion scope={scope} region="status" host={host} />
          </background-only>
        </AppLayoutFooter>
      </AppLayoutMain>
    </AppLayoutBody>
    <background-only><SessionRegion scope={scope} region="settings" host={host} /></background-only>
    <background-only><SessionRegion scope={scope} region="bootstrap" host={host} /></background-only>
  </AppLayout>;
}
