import 'background-only';
import { useAtomSet, useAtomValue } from '@effect/atom-react';
import { i18n, useTranslation } from '../../i18n';
import { sessionActionsAtom } from '../../state/session-actions';
import { settingsViewAtom } from '../../state/session-views';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

const languageNames: Record<string, string> = { en: 'English' };

function languageOptions(): { value: string; label: string }[] {
  return Object.keys(i18n.options.resources ?? { en: {} }).map((value) => ({
    value,
    label: languageNames[value] ?? value,
  }));
}

/** Display preferences: interface language today, theme and density later. */
export function DisplaySettings() {
  const view = useAtomValue(settingsViewAtom);
  const dispatch = useAtomSet(sessionActionsAtom);
  const { t } = useTranslation();
  const options = languageOptions();
  const current = options.find((option) => option.value === view.language)?.label ?? view.language;
  return (
    <view className="flex-1 min-w-0 flex flex-col px-[24px] py-[18px] gap-[18px]">
      <text className="text-[15px] text-[#e2e8ed]">{t('settings.display')}</text>
      <view className="w-[280px] flex flex-col gap-[6px]">
        <text className="text-[12px] text-[#c3cbd4]">{t('settings.language')}</text>
        <Select
          value={view.language}
          onValueChange={(language) => {
            'background only';
            dispatch({ type: 'changeLanguage', language });
          }}
        >
          <SelectTrigger data-automation-id="settings-language">
            <SelectValue>{current}</SelectValue>
          </SelectTrigger>
          <SelectContent
            data-automation-id="settings-language-content"
            dismissClassName="settings-language-dismiss"
          >
            {options.map((option) => (
              <SelectItem
                key={option.value}
                value={option.value}
                data-automation-id={`settings-language-${option.value}`}
              >
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <text className="text-[11px] text-[#8c99a7] leading-[17px]">
          {t('settings.languageDescription')}
        </text>
      </view>
    </view>
  );
}
