import 'background-only';
import { useAtomSet, useAtomValue } from '@effect/atom-react';
import { contentViewAtom } from '../../state/session-views';
import { sessionActionsAtom } from '../../state/session-actions';
import { SftpPanel } from '../sftp-panel';
import { PanelPlaceholder } from './panel-placeholder';
import { TmuxPanel } from './tmux-panel';

export function SessionContent() {
  const view = useAtomValue(contentViewAtom);
  const dispatch = useAtomSet(sessionActionsAtom);
  const activeTab = view.activeTab;
  const placeholder = !!view.error || !activeTab;
  const terminalVisible = !placeholder && activeTab?.kind !== 'sftp';
  // The terminal panel stays mounted for every state; TmuxPanel changes its
  // tmux chrome through props instead of swapping component types.
  const terminalTab = terminalVisible ? activeTab : undefined;
  return (
    <view className="flex-1 min-h-0 flex flex-col">
      <view className={terminalVisible ? 'flex-1 min-h-0 flex flex-col' : 'hidden'}>
        <TmuxPanel
          id={terminalTab?.id}
          sessionId={view.error ? 0 : view.terminalId}
          tab={terminalTab}
          host={view.host}
          terminalError={view.terminalError}
        />
      </view>
      {view.sftpTabs.map((tab) => (
        <view
          key={tab.id}
          className={
            !placeholder && activeTab?.id === tab.id ? 'flex-1 min-h-0 flex flex-col' : 'hidden'
          }
        >
          <SftpPanel id={tab.id} host={tab.profile.host!} tab={tab} profile={view.host} />
        </view>
      ))}
      {placeholder ? (
        <PanelPlaceholder
          host={view.host}
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
        />
      ) : null}
    </view>
  );
}
