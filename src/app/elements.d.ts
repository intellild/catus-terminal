import type { ViewProps } from '@lynx-js/types';

declare module '@lynx-js/types' {
  interface IntrinsicElements {
    'cover-view': ViewProps & { 'events-pass-through'?: boolean };
  }
}
