import 'background-only';

export function NativeTerminalView({ sessionId }: { sessionId: number }) {
  return (
    <native-terminal
      id="terminal-surface"
      terminal-id={sessionId}
      focusable
      className={sessionId === 0 ? 'hidden' : 'flex-1 w-full min-h-0'}
      bindtap={focus}
    />
  );
}

function focus() {
  'background only';
  lynx.createSelectorQuery().select('#terminal-surface').invoke({ method: 'focus' }).exec();
}
