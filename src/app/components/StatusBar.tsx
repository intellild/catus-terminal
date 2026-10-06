import { cn } from '../lib/utils';
export function StatusBar({
  workspaceCount = 0,
  tabCount = 0,
  hasSession = false,
}: {
  workspaceCount?: number;
  tabCount?: number;
  hasSession?: boolean;
}) {
  return (
    <>
      <view className={cn('flex flex-row items-center gap-[8px]')}>
        <view className={cn('w-[5px] h-[5px] rounded-[3px] bg-[#859e94]')} />
        <text id="session-summary" className={cn('text-[10px] text-[#8997a2]')}>
          {workspaceCount} {workspaceCount === 1 ? 'workspace' : 'workspaces'} open · {tabCount}{' '}
          {tabCount === 1 ? 'tab' : 'tabs'}
        </text>
      </view>
      <text className={cn('text-[10px] text-[#606d7b]')}>
        {hasSession ? 'Local session' : 'Ready'}
      </text>
    </>
  );
}
