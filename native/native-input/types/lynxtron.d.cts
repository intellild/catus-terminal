/** N-API class backed by a shared, thread-safe Rust instance. */
export class RustCounter {
  constructor(initial: number);
  readonly nativeId: string;
  readonly value: number;
  readonly cppCalls: number;
  add(delta: number): number;
  toNativeHandle(): { nativeId: string };
}
declare const nativeBinding: { RustCounter: typeof RustCounter };
export default nativeBinding;
