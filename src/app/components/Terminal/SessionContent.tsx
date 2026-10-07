import 'background-only';
import { useAtomSet, useAtomValue } from '@effect/atom-react';
import { contentViewAtom } from '../../state/sessionViews';
import { sessionActionsAtom } from '../../state/sessionActions';
import { SftpBrowser } from '../SftpBrowser';
import { TerminalView } from './TerminalView';
import { TerminalContent } from './TerminalContent';

export function SessionContent() {
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
          className={
            !view.error && view.activeTab?.id === tab.id ? 'flex-1 min-h-0 flex flex-col' : 'hidden'
          }
        >
          <SftpBrowser id={tab.id} host={tab.profile.host!} />
        </view>
      ))}
    </TerminalContent>
  );
}
