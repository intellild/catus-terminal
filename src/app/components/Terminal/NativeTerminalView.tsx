import 'background-only';
import type { NativeTerminalProps } from '../../../../native/elements';

export function NativeTerminalView({
  sessionId,
  onScrollChange,
}: {
  sessionId: number;
  onScrollChange?: NativeTerminalProps['bindscrollchange'];
}) {
  return (
    <native-terminal
      id="terminal-surface"
      terminal-id={sessionId}
      focusable
      className={sessionId === 0 ? 'hidden' : 'flex-1 w-full min-h-0'}
      bindtap={focus}
      bindscrollchange={onScrollChange}
    />
  );
}

function focus() {
  'background only';
  lynx.createSelectorQuery().select('#terminal-surface').invoke({ method: 'focus' }).exec();
}
