import { cn } from '../lib/utils';
import 'background-only';
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
  return (
    <view
      id="terminal-viewport"
      className={cn(
        id === undefined ? 'hidden' : 'flex-1 min-h-0 flex flex-col [-x-app-region:no-drag]',
      )}
    >
      <NativeTerminalView sessionId={sessionId} />
      {error ? (
        <text id="terminal-error" className={cn('text-[12px] text-[#e4a4a4] p-[12px]')}>
          {error}
        </text>
      ) : null}
    </view>
  );
}
