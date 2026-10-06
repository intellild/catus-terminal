import type { StandardProps } from '@lynx-js/types';

export interface NativeTerminalProps extends StandardProps {
  'terminal-id': number;
}

declare module '@lynx-js/types' {
  interface IntrinsicElements {
    'native-terminal': NativeTerminalProps;
  }
}
