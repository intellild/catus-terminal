import 'background-only';
import '../../runtime';
import { useAtomSet, useAtomValue } from '@effect/atom-react';
import { memo, useCallback, useEffect } from '@lynx-js/react';
import { tabViewAtom } from '../../state/session-views';
import { sessionActionsAtom } from '../../state/session-actions';
import { Button } from '../ui/button';
import { Icon } from '../ui/icon';
import { useTranslation } from '../../i18n';
import { cn } from '../../lib/utils';

export const TabItem = memo(function TabItem({ id }: { id: number }) {
  const { tab, active } = useAtomValue(tabViewAtom(id));
  const dispatch = useAtomSet(sessionActionsAtom);
  const { t } = useTranslation();
  const revealActiveTab = useCallback(() => {
    'background only';
    if (!active || !tab) {
      return;
    }
    lynx
      .createSelectorQuery()
      .select(`[data-automation-id=tab-${tab.number}]`)
      .invoke({
        method: 'scrollIntoView',
        params: { scrollIntoViewOptions: { block: 'center', inline: 'center', behavior: 'none' } },
      })
      .exec();
  }, [active, tab]);
  useEffect(revealActiveTab, [revealActiveTab]);
  if (!tab) {
    return null;
  }
  return (
    <Button
      variant="ghost"
      data-automation-id={`tab-${tab.number}`}
      bindtap={() => {
        'background only';
        dispatch({ type: 'focusTab', id });
      }}
      bindlayoutchange={revealActiveTab}
      className={cn(
        'w-[180px] h-[32px] px-[8px] gap-0 shrink-0 rounded-t-[7px] rounded-b-none flex flex-row items-center font-normal [-x-app-region:no-drag]',
        active ? 'bg-[#2b3037] border-t border-solid border-[#46504f]' : 'bg-[#22262c]',
      )}
    >
      <view className="flex-1 min-w-0 h-full flex flex-row items-center gap-[7px]">
        <view
          className="w-[5px] h-[5px] rounded-full shrink-0 bg-[var(--workspace-color)]"
          style={`--workspace-color: ${tab.profile.color}`}
        />
        {tab.kind !== 'shell' ? (
          <Icon
            name={tab.kind === 'tmux' ? 'panels-top-left' : 'folder'}
            size={12}
            color={tab.kind === 'tmux' ? '#c9b8ff' : '#a8e6cf'}
          />
        ) : null}
        <text
          className={cn(
            'text-[12px] whitespace-nowrap overflow-hidden text-ellipsis',
            active ? 'text-[#e1e8e5]' : 'text-[#959eaa]',
          )}
        >
          {t(
            tab.kind === 'sftp'
              ? 'tabs.sftpTitle'
              : tab.kind === 'tmux'
                ? 'tabs.tmuxTitle'
                : 'tabs.title',
            {
              name: tab.profile.name,
              number: tab.number,
            },
          )}
        </text>
      </view>
      <Button
        variant="ghost"
        size="icon"
        data-automation-id={`close-tab-${tab.number}`}
        className="w-[16px] h-[16px] flex justify-center items-center shrink-0"
        catchtap={() => {
          'background only';
          dispatch({ type: 'closeTab', id });
        }}
      >
        <Icon name="x" size={13} color="#9ca6b2" />
      </Button>
    </Button>
  );
});
