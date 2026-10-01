import type { RustCounter } from '@catus/native/lynxtron';

export interface RustSnapshot {
  nativeId: string;
  value: number;
  cppCalls: number;
}

function invoke<T>(method: string, params: object): Promise<T> {
  'background only';
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${method} timed out`)), 10000);
    lynx.createSelectorQuery().select('#demo-input').invoke({
      method,
      params,
      success: (result: unknown) => { clearTimeout(timeout); resolve(result as T); },
      fail: (error: unknown) => { clearTimeout(timeout); reject(new Error(JSON.stringify(error))); },
    }).exec();
  });
}

export async function verifyRustInterop(counter: RustCounter) {
  'background only';
  const jsBefore = counter.add(2);
  const rawObject = await invoke<{ isMap: boolean; hasAdd: boolean; addValueType: number; nativeId?: string; lynxValueType: number }>(
    'inspectRustObject', { rustObject: counter },
  );
  let transport = 'N-API instance properties';
  let rawBindError: string | undefined;
  let bound: RustSnapshot;
  try {
    bound = await invoke<RustSnapshot>('bindRustCounter', { rustObject: counter });
  } catch (error) {
    rawBindError = String(error);
    transport = 'explicit nativeId handle';
    bound = await invoke<RustSnapshot>('bindRustCounter', { rustObject: counter.toNativeHandle() });
  }
  const cpp = await invoke<RustSnapshot>('addRustCounter', { delta: 5 });
  const jsAfter = counter.value;
  const cppCalls = counter.cppCalls;
  if (jsBefore !== 12 || bound.value !== 12 || cpp.value !== 17 || jsAfter !== 17 ||
      cppCalls !== 1 || cpp.cppCalls !== 1 || cpp.nativeId !== counter.nativeId) {
    throw new Error(`Shared Rust instance verification failed: ${JSON.stringify({ jsBefore, bound, cpp, jsAfter, cppCalls })}`);
  }
  // A forged ID must fail without replacing the successfully bound instance.
  let invalidHandleRejected = false;
  try {
    await invoke('bindRustCounter', { rustObject: { nativeId: 'invalid-id' } });
  } catch {
    invalidHandleRejected = true;
  }
  const unchanged = await invoke<RustSnapshot>('addRustCounter', { delta: 0 });
  if (!invalidHandleRejected || unchanged.value !== 17 || counter.cppCalls !== 2) {
    throw new Error('Invalid handle replaced the native view binding');
  }
  const explicitHandle = await invoke<RustSnapshot>('bindRustCounter', {
    rustObject: counter.toNativeHandle(),
  });
  if (explicitHandle.nativeId !== counter.nativeId || explicitHandle.value !== 17) {
    throw new Error('Explicit handle does not refer to the original Rust instance');
  }
  return { passed: true, transport, rawObject, rawBindError, nativeId: counter.nativeId,
    jsBefore, cppAfter: cpp.value, jsAfter, cppCalls, invalidHandleRejected,
    explicitHandleVerified: true };
}
