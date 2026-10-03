import type { Config } from 'tailwindcss';
import lynxPreset from '@lynx-js/tailwind-preset';

export default {
  content: ['./src/app/**/*.{ts,tsx}'],
  presets: [lynxPreset],
} satisfies Config;
