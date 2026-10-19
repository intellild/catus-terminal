import 'background-only';
import '../../runtime';
import { useAtomSet, useAtomValue } from '@effect/atom-react';
import { workspaceViewAtom } from '../../state/sessionViews';
import { sessionActionsAtom } from '../../state/sessionActions';
import { memo, useState } from '@lynx-js/react';
import { useTranslation } from '../../i18n';
import { Button } from '../ui/Button';
import { cn } from '../../lib/utils';
import { ContextMenu, useContextMenuTrigger } from '../ui/ContextMenu';
import { WorkspaceContextMenu } from './WorkspaceContextMenu';
import { Popover, PopoverAnchor, usePopoverHoverTrigger, PopoverContent } from '../ui/Popover';

export const WorkspaceItem = memo(function WorkspaceItem({ id }: { id: string }) {
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <>
      <Popover>
        <WorkspaceItemContent
          id={id}
          onContextMenu={(point) => {
            setPoint(point);
            setMenuOpen(true);
          }}
          onSelect={() => setMenuOpen(false)}
        />
      </Popover>
      <ContextMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <WorkspaceContextMenu id={id} point={point} onEdit={() => setMenuOpen(false)} />
      </ContextMenu>
    </>
  );
});

function WorkspaceItemContent({
  id,
  onContextMenu,
  onSelect,
}: {
  id: string;
  onContextMenu(point: { x: number; y: number }): void;
  onSelect(): void;
}) {
  const { workspace, active, running } = useAtomValue(workspaceViewAtom(id));
  const dispatch = useAtomSet(sessionActionsAtom);
  const { t } = useTranslation();
  const hover = usePopoverHoverTrigger();
  const menu = useContextMenuTrigger(({ x, y }) => {
    hover.close();
    onContextMenu({ x, y });
  });
  if (!workspace) {
    return null;
  }
  const shell =
    workspace.command === '$SHELL'
      ? t('workspace.defaultShell')
      : [workspace.command, ...workspace.args].join(' ');
  return (
    <>
      <PopoverAnchor className="w-9 h-9 overflow-visible">
        <Button
          variant="ghost"
          ref={hover.ref}
          bindmouseenter={hover.onMouseEnter}
          bindmouseleave={hover.onMouseLeave}
          bindmousedown={menu.onMouseDown}
          data-automation-id={`workspace-${workspace.id}`}
          accessibility-label={workspace.name}
          className={cn(
            'w-9 h-9 p-0 rounded-[9px] relative',
            active && 'bg-[#303b40] hover:bg-[#3a474d]',
          )}
          bindtap={() => {
            hover.close();
            onSelect();
            dispatch({ type: 'openWorkspace', id });
          }}
        >
          <text
            className="text-[15px] font-bold text-[color:var(--workspace-color)]"
            style={`--workspace-color: ${active ? workspace.color : '#aeb7c4'}`}
          >
            {workspace.icon}
          </text>
          {running && (
            <view
              data-automation-id={`running-${workspace.id}`}
              className="absolute bottom-[2px] left-[16px] w-[4px] h-[4px] rounded-full bg-[var(--workspace-color)]"
              style={`--workspace-color: ${workspace.color}`}
            />
          )}
        </Button>
        <PopoverContent
          data-automation-id={`workspace-details-${workspace.id}`}
          side="right"
          align="center"
          sideOffset={12}
          modal={false}
          interactive={false}
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
          <text className="text-[11px] text-[#a0a8b5] break-all">
            {t('workspace.defaultTab')} · {t(`tabs.kind.${workspace.defaultTab}`)}
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
      </PopoverAnchor>
    </>
  );
}
