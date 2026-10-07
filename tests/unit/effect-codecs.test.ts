import { expect, test } from '@rstest/core';
import { execFileSync } from 'node:child_process';

// Use a fresh process: Effect modules imported by other tests may already have
// cached codecs, masking the eager initialization that fails in Lynx MTS.
test('Effect imports without codecs and creates reusable codecs only when encoding text', () => {
  const result = execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import assert from 'node:assert/strict';
    import { TextEncoder, TextDecoder } from 'node:util';
    // Initialize Node's lazy Undici globals before removing codecs; this test
    // targets Effect module initialization rather than Node's HTTP bootstrap.
    void globalThis.Response;
    void globalThis.Request;
    void globalThis.Headers;
    void globalThis.FormData;
    delete globalThis.TextEncoder;
    delete globalThis.TextDecoder;
    const { make } = await import('effect/reactivity/AtomRegistry');
    const registry = make();
    const Hex = await import('effect/encoding/Hex');
    const Base64 = await import('effect/encoding/Base64');
    const Base64Url = await import('effect/encoding/Base64Url');
    await import('effect/encoding/Ndjson');
    await import('effect/Random');
    assert.equal(typeof globalThis.TextEncoder, 'undefined');
    assert.equal(typeof globalThis.TextDecoder, 'undefined');
    assert.equal(Hex.encode(new Uint8Array([255])), 'ff');
    assert.equal(Base64.encode(new Uint8Array([255])), '/w==');
    let encoders = 0;
    let decoders = 0;
    globalThis.TextEncoder = class extends TextEncoder {
      constructor() { super(); encoders++; }
    };
    globalThis.TextDecoder = class extends TextDecoder {
      constructor(...args) { super(...args); decoders++; }
    };
    const text = '终端 🐈';
    const hex = Hex.encode(text);
    const base64 = Base64.encode(text);
    const url = Base64Url.encode(text);
    assert.equal(encoders, 2);
    for (let i = 0; i < 2; i++) {
      assert.equal(Hex.encode(text), hex);
      assert.equal(Base64.encode(text), base64);
    }
    assert.equal(encoders, 2);
    for (let i = 0; i < 2; i++) {
      assert.equal(Hex.decodeString(hex).success, text);
      assert.equal(Base64.decodeString(base64).success, text);
      assert.equal(Base64Url.decodeString(url).success, text);
    }
    assert.equal(decoders, 3);
    registry.dispose();
    console.log('ok');
  `,
    ],
    { encoding: 'utf8', timeout: 15000 },
  );
  expect(result.trim()).toBe('ok');
});
