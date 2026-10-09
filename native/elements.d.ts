import type { StandardProps } from '@lynx-js/types';

export interface NativeTerminalProps extends StandardProps {
  'terminal-id': number;
  /** Embed NSView by default; hosts without a native window always use OSR. */
  'use-osr'?: boolean;
}

declare module '@lynx-js/types' {
  interface IntrinsicElements {
    'native-terminal': NativeTerminalProps;
  }
}
