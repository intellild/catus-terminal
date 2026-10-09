import {
  AppLayout,
  AppLayoutBody,
  AppLayoutContent,
  AppLayoutFooter,
  AppLayoutHeader,
  AppLayoutMain,
  AppLayoutSidebar,
} from './components/AppLayout';
import { TabBar } from './components/TabBar';
import { TerminalContent } from './components/Terminal/TerminalContent';
import { StatusBar } from './components/StatusBar';
import {
  SessionTabs,
  SessionTabActions,
  SessionWorkspaces,
  SessionContent,
  SessionStatus,
  SessionSettings,
} from './components/SessionViews';
import { SessionProvider } from './state/SessionProvider';
import { useFrameDriver } from './frameDriver';
import './tailwind.css';

export function App() {
  useFrameDriver();
  return (
    <SessionProvider>
      <AppLayout>
        <AppLayoutHeader>
          <view
            id="window-controls-space"
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
              <background-only fallback={<TerminalContent loading />}>
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
          <SessionSettings />
        </background-only>
      </AppLayout>
    </SessionProvider>
  );
}
