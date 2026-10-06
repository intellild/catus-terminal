import 'background-only';
import type { KeyEvent } from '@lynx-js/types';

export function NativeTerminalView({ sessionId }: { sessionId: number }) {
  const key = (event: KeyEvent) => {
    'background only';
    // macOS system shortcuts stay with the host; ordinary/control/option keys go to the PTY.
    if (event.metaKey) return;
    lynx
      .createSelectorQuery()
      .select('#terminal-surface')
      .invoke({
        method: 'key',
        params: { key: event.key, control: event.ctrlKey, alt: event.altKey },
      })
      .exec();
  };
  return (
    <native-terminal
      id="terminal-surface"
      terminal-id={sessionId}
      focusable
      className={sessionId === 0 ? 'hidden' : 'flex-1 w-full min-h-0'}
      bindtap={focus}
      catchkeydown={key}
    />
  );
}

function focus() {
  'background only';
  lynx.createSelectorQuery().select('#terminal-surface').invoke({ method: 'focus' }).exec();
}
