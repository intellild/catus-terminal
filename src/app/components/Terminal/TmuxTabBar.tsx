import 'background-only';
import '../../runtime';
import { useAtomSet, useAtomValue } from '@effect/atom-react';
import { tmuxActionsAtom, tmuxSessionAtom } from '../../state/tmux';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icon';
import { useTranslation } from '../../i18n';
import { cn } from '../../lib/utils';

/**
 * Tmux owns the tabs inside a tmux terminal. Snapshots and window commands live
 * in the application registry; this view only subscribes by session ID and
 * dispatches commands.
 */
export function TmuxTabBar({ sessionId }: { sessionId: number }) {
  const { t } = useTranslation();
  const info = useAtomValue(tmuxSessionAtom(sessionId));
  const dispatch = useAtomSet(tmuxActionsAtom);
  const windows = info?.windows ?? [];
  return (
    <scroll-view
      data-automation-id="tmux-tabs"
      scroll-x
      className="flex-1 min-w-0 h-full flex flex-row items-center"
    >
      <view className="flex flex-row items-center h-full gap-[3px] pr-[6px]">
        {windows.map((window) => {
          const label = `${window.index}: ${window.name}`;
          return (
            <Button
              key={window.id}
              variant="ghost"
              data-automation-id={`tmux-window-${window.index}`}
              data-active={window.active ? 'true' : 'false'}
              accessibility-label={t('terminal.tmuxWindow', { name: label })}
              className={cn(
                'h-[26px] max-w-[170px] pl-[8px] pr-[4px] gap-[2px] rounded-[5px] font-normal',
                window.active ? 'bg-[#2b3037] text-[#e1e8e5]' : 'text-[#8c99a7]',
              )}
              bindtap={() => {
                'background only';
                dispatch({ type: 'selectWindow', sessionId, windowId: window.id });
              }}
            >
              <text
                className={cn(
                  'text-[11px] whitespace-nowrap overflow-hidden text-ellipsis',
                  window.active ? 'text-[#e1e8e5]' : 'text-[#8c99a7]',
                )}
              >
                {label}
              </text>
              {windows.length > 1 ? (
                <Button
                  variant="ghost"
                  size="icon"
                  data-automation-id={`close-tmux-window-${window.index}`}
                  accessibility-label={t('terminal.closeTmuxWindow', { name: label })}
                  className="w-[14px] h-[14px] shrink-0"
                  catchtap={() => {
                    'background only';
                    dispatch({ type: 'closeWindow', sessionId, windowId: window.id });
                  }}
                >
                  <Icon name="x" size={11} color="#9ca6b2" />
                </Button>
              ) : null}
            </Button>
          );
        })}
        {info ? (
          <Button
            variant="ghost"
            size="icon-sm"
            data-automation-id="tmux-new-window"
            accessibility-label={t('terminal.newTmuxWindow')}
            className="w-[22px] h-[22px] rounded-[5px]"
            bindtap={() => {
              'background only';
              dispatch({ type: 'createWindow', sessionId });
            }}
          >
            <Icon name="plus" size={14} color="#c1c7d0" />
          </Button>
        ) : (
          <text className="text-[11px] text-[#65717f]">{t('terminal.tmuxStarting')}</text>
        )}
      </view>
    </scroll-view>
  );
}
