import { useState } from '@lynx-js/react';
import { useTranslation } from '../../i18n';
import { cn } from '../../lib/utils';
import { ContextMenuTrigger } from '../ui/ContextMenu';
import { Popover, PopoverHoverTrigger, PopoverContent } from '../ui/Popover';
import type { Workspace } from '../../../shared/workspaces';

export function WorkspaceItem({
  workspace,
  active,
  running,
  onSelect,
  onContextMenu,
}: {
  workspace: Workspace;
  active: boolean;
  running: boolean;
  onSelect?(id: string): void;
  onContextMenu?(id: string, x: number, y: number): void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const shell =
    workspace.command === '$SHELL'
      ? t('workspace.defaultShell')
      : [workspace.command, ...workspace.args].join(' ');
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverHoverTrigger id={`workspace-hover-${workspace.id}`} className="w-10 h-10">
        <ContextMenuTrigger
          id={`workspace-${workspace.id}`}
          accessibility-label={workspace.name}
          className={cn(
            'w-10 h-10 p-0 rounded-[10px] relative',
            active && 'bg-[#303b40] hover:bg-[#3a474d]',
          )}
          bindtap={() => {
            setOpen(false);
            onSelect?.(workspace.id);
          }}
          onContextMenu={({ x, y }) => {
            setOpen(false);
            onContextMenu?.(workspace.id, x, y);
          }}
        >
          <text
            className="text-[16px] font-bold text-[color:var(--workspace-color)]"
            style={`--workspace-color: ${active ? workspace.color : '#aeb7c4'}`}
          >
            {workspace.icon}
          </text>
          {running && (
            <view
              id={`running-${workspace.id}`}
              className="absolute bottom-[3px] left-[18px] w-[4px] h-[4px] rounded-full bg-[var(--workspace-color)]"
              style={`--workspace-color: ${workspace.color}`}
            />
          )}
        </ContextMenuTrigger>
      </PopoverHoverTrigger>
      <PopoverContent
        id={`workspace-details-${workspace.id}`}
        side="right"
        align="center"
        sideOffset={12}
        modal={false}
        className="w-[240px] p-[12px] flex flex-col gap-[8px]"
      >
        <text className="text-[13px] font-bold text-[#e2e8ed] break-all">{workspace.name}</text>
        <text className="text-[11px] text-[#a8e6cf]">
          {t(workspace.type === 'ssh' ? 'common.ssh' : 'common.local')}
        </text>
        {workspace.type === 'ssh' && (
          <text className="text-[11px] text-[#a0a8b5] break-all">
            {t('workspace.host')} · {workspace.host}
          </text>
        )}
        <text className="text-[11px] text-[#a0a8b5] break-all">
          {t('workspace.shell')} · {shell}
        </text>
        {workspace.remoteCommand && (
          <text className="text-[11px] text-[#a0a8b5] break-all">
            {t('workspace.extraCommand')} · {workspace.remoteCommand}
          </text>
        )}
        <text className="text-[11px] text-[#a0a8b5] break-all">
          {t('workspace.cwd')} · {workspace.cwd}
        </text>
      </PopoverContent>
    </Popover>
  );
}
