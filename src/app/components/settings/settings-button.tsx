import 'background-only';
import { useAtomSet } from '@effect/atom-react';
import { useTranslation } from '../../i18n';
import { sessionActionsAtom } from '../../state/session-actions';
import { Button } from '../ui/button';
import { Icon } from '../ui/icon';

/** Bottom-left entry to the host and display settings. */
export function SettingsButton() {
  const dispatch = useAtomSet(sessionActionsAtom);
  const { t } = useTranslation();
  return (
    <Button
      variant="ghost"
      size="icon"
      data-automation-id="open-settings"
      accessibility-label={t('settings.title')}
      className="w-9 h-9 rounded-[9px] mt-[6px] mb-[2px]"
      bindtap={() => {
        'background only';
        dispatch({ type: 'openSettings' });
      }}
    >
      <Icon name="settings" size={18} color="#969fab" />
    </Button>
  );
}
