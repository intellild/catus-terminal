import 'background-only';

// BTS shares Node's thread, but its global object is isolated. Install the
// preload's Node codecs before Effect initializes its encoding modules.
if (typeof globalThis.TextEncoder === 'undefined' || typeof globalThis.TextDecoder === 'undefined') {
  const codecs = NativeModules.nodejs.exposed as {
    createTextEncoder(): InstanceType<typeof globalThis.TextEncoder>;
    createTextDecoder(label?: string, options?: ConstructorParameters<typeof globalThis.TextDecoder>[1]): InstanceType<typeof globalThis.TextDecoder>;
  };
  // contextBridge exposes callable functions without [[Construct]]. These local
  // constructors return actual Node codec instances created in the preload VM.
  function NodeTextEncoder() { return codecs.createTextEncoder(); }
  function NodeTextDecoder(label?: string, options?: ConstructorParameters<typeof globalThis.TextDecoder>[1]) {
    return codecs.createTextDecoder(label, options);
  }
  Object.assign(globalThis, { TextEncoder: NodeTextEncoder, TextDecoder: NodeTextDecoder });
}
