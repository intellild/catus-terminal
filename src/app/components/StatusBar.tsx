export function StatusBar({ workspaceCount = 0, tabCount = 0, hasSession = false }: {
  workspaceCount?: number;
  tabCount?: number;
  hasSession?: boolean;
}) {
  return <>
    <view className="StatusLeading"><view className="StatusDot" /><text id="session-summary" className="StatusText">{workspaceCount} {workspaceCount === 1 ? 'workspace' : 'workspaces'} open · {tabCount} {tabCount === 1 ? 'tab' : 'tabs'}</text></view>
    <text className="StatusHint">{hasSession ? 'Local session · placeholder' : 'Ready'}</text>
  </>;
}
