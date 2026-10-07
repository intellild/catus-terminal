import { Button } from '../ui/Button';
import { cn } from '../../lib/utils';
import { ContextMenuTrigger } from '../ui/ContextMenu';
import type { Workspace } from '../../../shared/workspaces';

export function WorkspaceList({
  workspaces = [],
  activeWorkspaceId,
  runningIds = new Set<string>(),
  loading = false,
  onSelect,
  onAdd,
  onContextMenu,
}: {
  workspaces?: readonly Workspace[];
  activeWorkspaceId?: string | null;
  runningIds?: ReadonlySet<string>;
  loading?: boolean;
  onSelect?(id: string): void;
  onAdd?(): void;
  onContextMenu?(id: string, x: number, y: number): void;
}) {
  return (
    <>
      <scroll-view scroll-y className="w-[64px] flex-1 min-h-0">
        <view className="flex flex-col items-center">
          {loading &&
            !workspaces.length &&
            [0, 1, 2].map((index) => (
              <view key={index} className="w-[64px] flex flex-col items-center mb-[26px]">
                <view className="w-[43px] h-[43px] rounded-[12px] flex items-center justify-center bg-[#25292f]" />
                <view className="w-[36px] h-[6px] bg-[#30353b] rounded-[3px] mt-[10px]" />
              </view>
            ))}
          {workspaces.map((item) => (
            <ContextMenuTrigger
              id={`workspace-${item.id}`}
              key={item.id}
              className={cn(
                'w-[64px] h-auto p-0 flex-col gap-0 pt-[5px] mb-[13px] rounded-[12px] font-normal',
                activeWorkspaceId === item.id ? 'bg-[#252b30]' : '',
              )}
              bindtap={() => onSelect?.(item.id)}
              onContextMenu={({ x, y }) => onContextMenu?.(item.id, x, y)}
            >
              <view
                className="w-[43px] h-[43px] rounded-[12px] flex items-center justify-center bg-[var(--workspace-color)]"
                style={`--workspace-color: ${activeWorkspaceId === item.id ? item.color : '#25292f'}`}
              >
                <text
                  className={cn(
                    'text-[17px] font-bold',
                    activeWorkspaceId === item.id ? 'text-[#21352f]' : 'text-[#aeb7c4]',
                  )}
                >
                  {item.icon}
                </text>
              </view>
              <text className="text-[10px] text-[#a0a8b5] mt-[7px] w-[60px] text-center overflow-hidden text-ellipsis whitespace-nowrap">
                {item.name}
              </text>
              <view className="h-[13px] flex justify-center items-center">
                {runningIds.has(item.id) && (
                  <view
                    id={`running-${item.id}`}
                    className="w-[4px] h-[4px] rounded-[2px] bg-[var(--workspace-color)]"
                    style={`--workspace-color: ${item.color}`}
                  />
                )}
              </view>
            </ContextMenuTrigger>
          ))}
        </view>
      </scroll-view>
      <Button
        variant="secondary"
        size="icon"
        id="add-workspace"
        className="w-[44px] h-[44px] rounded-[12px] mt-[10px]"
        bindtap={onAdd}
      >
        <text className="text-[22px] text-[#969fab]">+</text>
      </Button>
    </>
  );
}
