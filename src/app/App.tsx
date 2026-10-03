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
import './tailwind.css';

export function App({ host }: { host?: WorkspaceHost }) {
  const [scope] = useState<SessionScope>({});
  return <AppLayout>
    <AppLayoutHeader>
      <view id="window-controls-space" className="w-[92px] h-[54px] shrink-0 [-x-app-region:drag]" />
      <AppLayoutHeaderContent>
        <background-only fallback={<TabBar loading />}>
          <SessionRegion scope={scope} region="tabs" host={host} />
        </background-only>
        <view className="flex-1 min-w-[32px] h-[54px] [-x-app-region:drag]" />
        <view className="w-[1px] h-[18px] ml-[12px] mr-[16px] bg-[#363b42]" />
        <text className="text-[11px] text-[#717b88] shrink-0">Catus Terminal</text>
      </AppLayoutHeaderContent>
    </AppLayoutHeader>
    <AppLayoutBody>
      <AppLayoutSidebar>
        <view className="w-[38px] h-[38px] rounded-[13px] bg-[#a8e6cf] flex justify-center items-center"><text className="text-[30px] leading-[34px] font-bold text-[#1c3930]">c</text></view>
        <view className="h-[1px] w-[32px] bg-[#30353b] mt-[20px] mb-[18px]" />
        <background-only fallback={<WorkspaceList loading />}>
          <SessionRegion scope={scope} region="workspaces" host={host} />
        </background-only>
        <text className="text-[8px] text-[#6e7784] tracking-[1px] mt-[13px]">CATUS</text>
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
