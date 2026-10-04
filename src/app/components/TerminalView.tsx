import 'background-only';
import type { TerminalTab } from '../state/session';
import { useTerminalSession } from '../state/useTerminalSession';
import { NativeTerminalView } from './NativeTerminalView';

export function TerminalView({ tabs, id }: { tabs: readonly TerminalTab[]; id?: string }) {
  const { sessionId, error } = useTerminalSession(tabs, id);
  return (
    <view
      className={
        id === undefined ? 'hidden' : 'flex-1 min-h-0 flex flex-col [-x-app-region:no-drag]'
      }
    >
      <NativeTerminalView sessionId={sessionId} />
      {error ? (
        <text id="terminal-error" className="text-[12px] text-[#e4a4a4] p-[12px]">
          {error}
        </text>
      ) : null}
    </view>
  );
}
