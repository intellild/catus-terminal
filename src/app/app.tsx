import {
  AppLayout,
  AppLayoutBody,
  AppLayoutContent,
  AppLayoutFooter,
  AppLayoutHeader,
  AppLayoutMain,
  AppLayoutSidebar,
} from './components/app-layout';
import { TabBar } from './components/tab-bar';
import { PanelPlaceholder } from './components/terminal/panel-placeholder';
import { StatusBar } from './components/status-bar';
import {
  SessionTabs,
  SessionTabActions,
  SessionWorkspaces,
  SessionContent,
  SessionStatus,
} from './components/session-views';
import { SettingsDialog } from './components/settings/settings-dialog';
import { SessionProvider } from './state/session-provider';
import { useFrameDriver } from './frame-driver';
import './tailwind.css';

export function App() {
  useFrameDriver();
  return (
    <SessionProvider>
      <AppLayout>
        <AppLayoutHeader>
          <view
            data-automation-id="window-controls-space"
            className="w-[76px] h-full shrink-0 [-x-app-region:drag]"
          />

          <TabBar>
            <background-only>
              <SessionTabs />
            </background-only>
          </TabBar>
          <background-only>
            <SessionTabActions />
          </background-only>
          <view className="flex-1 min-w-[32px] h-full [-x-app-region:drag]" />
          <view className="w-[1px] h-[18px] ml-[12px] mr-[16px] bg-[#363b42]" />
          <text className="text-[11px] text-[#717b88] shrink-0">Catus Terminal</text>
        </AppLayoutHeader>
        <AppLayoutBody>
          <AppLayoutSidebar>
            <background-only>
              <SessionWorkspaces />
            </background-only>
          </AppLayoutSidebar>
          <AppLayoutMain>
            <AppLayoutContent>
              <background-only fallback={<PanelPlaceholder loading />}>
                <SessionContent />
              </background-only>
            </AppLayoutContent>
            <AppLayoutFooter>
              <background-only fallback={<StatusBar />}>
                <SessionStatus />
              </background-only>
            </AppLayoutFooter>
          </AppLayoutMain>
        </AppLayoutBody>
        <background-only>
          <SettingsDialog />
        </background-only>
      </AppLayout>
    </SessionProvider>
  );
}
