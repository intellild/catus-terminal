import 'background-only';
import { useAtomSet, useAtomValue } from '@effect/atom-react';
import { useTranslation } from '../../i18n';
import { cn } from '../../lib/utils';
import { sessionActionsAtom } from '../../state/session-actions';
import { settingsViewAtom } from '../../state/session-views';
import type { SettingsSection } from '../../state/settings';
import { Button } from '../ui/button';
import { Dialog, DialogContent } from '../ui/dialog';
import { Icon } from '../ui/icon';
import type { IconName } from '../ui/icons';
import { DisplaySettings } from './display-settings';
import { HostSettings } from './host-settings';

const sections: { id: SettingsSection; icon: IconName }[] = [
  { id: 'hosts', icon: 'server' },
  { id: 'display', icon: 'settings' },
];

/** One mount point: the sidebar and the host context menu only dispatch open. */
export function SettingsDialog() {
  const view = useAtomValue(settingsViewAtom);
  const dispatch = useAtomSet(sessionActionsAtom);
  const { t } = useTranslation();
  return (
    <Dialog
      open={view.open}
      onOpenChange={(open) => {
        if (!open) {
          dispatch({ type: 'closeSettings' });
        }
      }}
    >
      <DialogContent
        data-automation-id="settings-dialog"
        overlayProps={{ 'data-automation-id': 'settings-overlay' }}
        closeButtonProps={{ 'data-automation-id': 'close-settings' }}
        className="w-[820px] h-[560px] max-w-[92%] max-h-[88%] p-0 overflow-hidden"
      >
        <view className="flex-1 min-h-0 flex flex-row">
          <view className="w-[148px] shrink-0 flex flex-col gap-[2px] p-[10px] bg-[#171b20] border-r border-solid border-[#2c333b]">
            <text className="px-[10px] pt-[2px] pb-[10px] text-[11px] text-[#717b88]">
              {t('settings.title')}
            </text>
            {sections.map((section) => {
              const active = view.section === section.id;
              return (
                <Button
                  key={section.id}
                  variant="ghost"
                  data-automation-id={`settings-nav-${section.id}`}
                  className={cn(
                    'w-full h-[30px] px-[10px] justify-start gap-[8px] rounded-[6px]',
                    active && 'bg-[#2b333b]',
                  )}
                  bindtap={() => {
                    'background only';
                    dispatch({ type: 'selectSettingsSection', section: section.id });
                  }}
                >
                  <Icon name={section.icon} size={14} color={active ? '#a8e6cf' : '#8c99a7'} />
                  <text className={cn('text-[12px]', active ? 'text-[#e1e8e5]' : 'text-[#a0a8b5]')}>
                    {t(`settings.section.${section.id}`)}
                  </text>
                </Button>
              );
            })}
          </view>
          {view.section === 'hosts' ? <HostSettings /> : <DisplaySettings />}
        </view>
      </DialogContent>
    </Dialog>
  );
}
