import 'background-only';
import { useState } from '@lynx-js/react';
import { ScrollBar } from '../ui/ScrollBar';
import { NativeTerminalView } from './NativeTerminalView';

export function TerminalView({
  id,
  sessionId,
  error,
}: {
  id?: number;
  sessionId: number;
  error: string;
}) {
  const [scroll, setScroll] = useState({ sessionId: 0, offset: 0, historyRows: 0, visibleRows: 0 });
  const current =
    scroll.sessionId === sessionId ? scroll : { offset: 0, historyRows: 0, visibleRows: 0 };
  return (
    <view
      data-automation-id="terminal-viewport"
      className={
        id === undefined ? 'hidden' : 'flex-1 min-h-0 flex flex-col [-x-app-region:no-drag]'
      }
    >
      <view className="relative z-0 flex-1 min-h-0 flex flex-col">
        <NativeTerminalView
          sessionId={sessionId}
          onScrollChange={(event) => {
            if (event.detail.sessionId === sessionId) {
              setScroll(event.detail);
            }
          }}
        />
        <ScrollBar
          data-automation-id="terminal-scrollbar"
          resetKey={sessionId}
          {...current}
          onOffsetChange={(offset) => {
            lynx
              .createSelectorQuery()
              .select('[data-automation-id=terminal-surface]')
              .invoke({ method: 'scrollTo', params: { sessionId, offset } })
              .exec();
          }}
        />
      </view>
      {error ? (
        <text data-automation-id="terminal-error" className="text-[12px] text-[#e4a4a4] p-[12px]">
          {error}
        </text>
      ) : null}
    </view>
  );
}
