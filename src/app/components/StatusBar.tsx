export function StatusBar({ workspaceCount = 0, tabCount = 0, hasSession = false }: {
  workspaceCount?: number;
  tabCount?: number;
  hasSession?: boolean;
}) {
  return <>
    <view className="flex flex-row items-center gap-[8px]"><view className="w-[5px] h-[5px] rounded-[3px] bg-[#859e94]" /><text id="session-summary" className="text-[10px] text-[#8997a2]">{workspaceCount} {workspaceCount === 1 ? 'workspace' : 'workspaces'} open · {tabCount} {tabCount === 1 ? 'tab' : 'tabs'}</text></view>
    <text className="text-[10px] text-[#606d7b]">{hasSession ? 'Local session · placeholder' : 'Ready'}</text>
  </>;
}
