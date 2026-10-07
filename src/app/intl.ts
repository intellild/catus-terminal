// Lynx VMs lack Intl. Load prerequisites before PluralRules and only English
// plural data; conditional polyfills preserve native implementations in Node.
// Keep the tested FormatJS majors in package.json: PluralRules 6 / Locale 5 /
// GetCanonicalLocales 3 prevented Lynxtron 0.0.28 from loading the app bundle,
// even with source.include transpilation. Recheck in windowless E2E on upgrade.
import '@formatjs/intl-getcanonicallocales/polyfill.js';
import '@formatjs/intl-locale/polyfill.js';
import '@formatjs/intl-pluralrules/polyfill.js';
import '@formatjs/intl-pluralrules/locale-data/en.js';
