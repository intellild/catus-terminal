export * from './index.js';
export type { NativeInputEvent, NativeInputProps, NativeTerminalProps } from './elements.js';
import type { RustCounter } from './index.js';
declare const nativeBinding: { RustCounter: typeof RustCounter };
export default nativeBinding;
