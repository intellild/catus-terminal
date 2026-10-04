import type { BaseEvent, StandardProps } from '@lynx-js/types';

export type NativeInputEvent = BaseEvent<'input', { value: string }>;

export interface NativeInputProps extends StandardProps {
  value?: string;
  placeholder?: string;
  bindinput?: (event: NativeInputEvent) => void;
}

export interface NativeTerminalProps extends StandardProps {
  'terminal-id': string;
}

declare module '@lynx-js/types' {
  interface IntrinsicElements {
    'native-input': NativeInputProps;
    'native-terminal': NativeTerminalProps;
  }
}
