export * from './index.js';
export type { NativeInputEvent, NativeInputProps, NativeTerminalProps } from './elements.js';
import type { RustCounter, RustTerminal } from './index.js';
declare const nativeBinding: { RustCounter: typeof RustCounter; RustTerminal: typeof RustTerminal };
export default nativeBinding;
