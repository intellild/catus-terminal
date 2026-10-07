import './intl';
import { createInstance } from 'i18next';
import type { i18n as I18n } from 'i18next';
import { initReactI18next } from 'react-i18next';
import english from '../../locales/en.toml';

// Bundled resources initialize synchronously in both Lynx runtimes, including
// the main-thread skeleton. No browser detection, filesystem or network backend.
export const i18n: I18n = createInstance();
void i18n.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  resources: { en: { translation: english } },
  initImmediate: false,
  react: { useSuspense: false },
  interpolation: { escapeValue: false },
});
export { useTranslation } from 'react-i18next';
