import { useState } from '@lynx-js/react';
import type { TmuxSessionSummary } from '../../../shared/tmux';
import { useTranslation } from '../../i18n';
import { cn } from '../../lib/utils';
import { Button } from '../ui/Button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  useContextMenuTrigger,
} from '../ui/ContextMenu';
import { Icon } from '../ui/Icon';

export interface TmuxSessionsProps {
  readonly sessions: readonly TmuxSessionSummary[];
  /** Called when the menu opens so the list reflects the current machine. */
  onOpen?(): void;
  onAttach(session: string): void;
  onNew(): void;
  onClose(session: string): void;
}

/** The tmux add button owns the machine's session badge and attach menu. */
export function TmuxTabButton({
  id,
  label,
  onAdd,
  tmux,
}: {
  id: string;
  label: string;
  onAdd(): void;
  tmux?: TmuxSessionsProps;
}) {
  const { t } = useTranslation();
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const [open, setOpen] = useState(false);
  const sessions = tmux?.sessions ?? [];
  const menu = useContextMenuTrigger((triggerPoint) => {
    setPoint(triggerPoint);
    setOpen(true);
    tmux?.onOpen?.();
  });
  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        data-automation-id={id}
        accessibility-label={label}
        className="w-[24px] h-[24px] rounded-[6px] relative overflow-visible"
        bindmousedown={menu.onMouseDown}
        bindtap={() => {
          'background only';
          onAdd();
        }}
      >
        <Icon name="panels-top-left" size={15} color="#c9b8ff" />
        {sessions.length > 0 ? (
          <view
            data-automation-id="tmux-session-count"
            className="absolute top-[-5px] right-[-6px] min-w-[13px] h-[13px] px-[3px] rounded-[7px] bg-[#4d3f6b] flex flex-row items-center justify-center"
          >
            <text className="text-[9px] leading-[11px] text-[#dcd2ff]">{sessions.length}</text>
          </view>
        ) : null}
      </Button>
      <ContextMenu
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) {
            tmux?.onOpen?.();
          }
        }}
      >
        {point ? (
          <ContextMenuContent
            point={point}
            data-automation-id="tmux-session-menu"
            dismissClassName="tmux-session-menu-dismiss"
            className="w-[230px]"
          >
            {sessions.length === 0 ? (
              <text className="text-[12px] text-[#717b88] px-[12px] py-[8px]">
                {t('tmux.noSessions')}
              </text>
            ) : (
              sessions.map((session) => (
                <TmuxSessionMenuItem
                  key={session.name}
                  session={session}
                  onAttach={(name) => {
                    setOpen(false);
                    tmux?.onAttach(name);
                  }}
                  onClose={(name) => tmux?.onClose(name)}
                />
              ))
            )}
            <ContextMenuSeparator />
            <ContextMenuItem
              data-automation-id="tmux-new-session"
              onSelect={() => {
                setOpen(false);
                tmux?.onNew();
              }}
            >
              {t('tmux.newSession')}
            </ContextMenuItem>
          </ContextMenuContent>
        ) : null}
      </ContextMenu>
    </>
  );
}

// The row stays hoverable while the close action appears: attaching and closing
// are separate hit areas, so no nested buttons or event propagation are needed.
function TmuxSessionMenuItem({
  session,
  onAttach,
  onClose,
}: {
  session: TmuxSessionSummary;
  onAttach(session: string): void;
  onClose(session: string): void;
}) {
  const [hover, setHover] = useState(false);
  const { t } = useTranslation();
  return (
    <view
      data-automation-id={`tmux-session-row-${session.name}`}
      className={cn('h-[30px] flex flex-row items-center rounded-[5px]', hover && 'bg-[#2b3138]')}
      bindmouseenter={() => setHover(true)}
      bindmouseleave={() => setHover(false)}
    >
      <view
        data-automation-id={`tmux-session-${session.name}`}
        className="flex-1 min-w-0 h-full flex flex-row items-center gap-[8px] px-[10px]"
        bindtap={() => {
          'background only';
          onAttach(session.name);
        }}
      >
        <text className="text-[13px] text-[#e2e8ed]">{session.name}</text>
        <text className="text-[10px] text-[#717b88]">
          {t('tmux.windows', { count: session.windows })}
        </text>
      </view>
      {hover ? (
        <Button
          variant="ghost"
          size="icon-sm"
          data-automation-id={`close-tmux-session-${session.name}`}
          accessibility-label={t('tmux.closeSession', { name: session.name })}
          className="w-[22px] h-[22px] mr-[4px] rounded-[4px]"
          bindtap={() => {
            'background only';
            onClose(session.name);
          }}
        >
          <Icon name="x" size={13} color="#9ca6b2" />
        </Button>
      ) : null}
    </view>
  );
}
