import type { WorkspaceHost } from '../shared/workspaces';
import { WorkspaceApp } from './TerminalApp';
import './App.css';

export function App({ host }: { host?: WorkspaceHost }) {
  return <background-only fallback={<view className="Application"><view className="EmptyState"><text className="EmptyTitle">Opening Catus…</text></view></view>}>
    <WorkspaceApp host={host} />
  </background-only>;
}
