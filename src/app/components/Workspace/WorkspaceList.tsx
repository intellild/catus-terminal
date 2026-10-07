import { Button } from '../ui/Button';
import { WorkspaceItem } from './WorkspaceItem';
import { useTranslation } from '../../i18n';
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
  const { t } = useTranslation();
  return (
    <>
      <scroll-view scroll-y className="w-14 flex-1 min-h-0">
        <view className="flex flex-col items-center gap-[8px] py-[4px]">
          {loading &&
            !workspaces.length &&
            [0, 1, 2].map((index) => (
              <view key={index} className="w-10 h-10 rounded-[10px] bg-[#25292f]" />
            ))}
          {workspaces.map((workspace) => (
            <WorkspaceItem
              key={workspace.id}
              workspace={workspace}
              active={activeWorkspaceId === workspace.id}
              running={runningIds.has(workspace.id)}
              onSelect={onSelect}
              onContextMenu={onContextMenu}
            />
          ))}
        </view>
      </scroll-view>
      <Button
        variant="secondary"
        size="icon"
        id="add-workspace"
        accessibility-label={t('workspace.add')}
        className="w-10 h-10 rounded-[10px] mt-[8px] mb-[4px]"
        bindtap={onAdd}
      >
        <text className="text-[22px] text-[#969fab]">+</text>
      </Button>
    </>
  );
}
