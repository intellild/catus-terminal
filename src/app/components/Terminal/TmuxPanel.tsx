import { TerminalPanel, type TerminalPanelProps } from './TerminalPanel';
import { TmuxTabBar } from './TmuxTabBar';

type TmuxPanelProps = Omit<TerminalPanelProps, 'titleTabs'>;

/**
 * Stable terminal session panel: it embeds a TerminalPanel and adds tmux window
 * tabs when the active tab is a tmux session. Shell and tmux tabs share this
 * outer panel, so switching kinds does not remount the native terminal element.
 */
export function TmuxPanel({ tab, terminalError, ...props }: TmuxPanelProps) {
  return (
    <TerminalPanel
      {...props}
      tab={tab}
      terminalError={terminalError}
      titleTabs={
        tab?.kind === 'tmux' && !terminalError ? <TmuxTabBar sessionId={tab.id} /> : undefined
      }
    />
  );
}
