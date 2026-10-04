import 'background-only';
import type { TerminalTab } from '../state/session';
import { TerminalView } from './TerminalView';

// Keep each tab's TerminalView mounted while only its active native view is visible.
export function TerminalSurface({
  tabs,
  activeId,
}: {
  tabs: readonly TerminalTab[];
  activeId?: string;
}) {
  return (
    <>
      {tabs.map((tab) => (
        <TerminalView key={tab.id} active={tab.id === activeId} />
      ))}
    </>
  );
}
