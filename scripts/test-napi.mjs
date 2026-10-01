import assert from 'node:assert/strict';
import { buildNative } from '../native/build.mjs';

// Build through napi-rs with the view disabled for this isolated Node process.
// The application artifact keeps the C++ view and is verified in Lynxtron.
const binary = await buildNative({ nativeView: false });
const addon = { exports: {} };
process.dlopen(addon, binary);
const { RustCounter } = addon.exports;
const first = new RustCounter(10);
const second = new RustCounter(100);
assert.equal(first.add(2), 12);
assert.equal(first.value, 12);
assert.equal(first.cppCalls, 0);
assert.equal(second.value, 100);
assert.notEqual(first.nativeId, second.nativeId);
assert.deepEqual(first.toNativeHandle(), { nativeId: first.nativeId });
assert.throws(() => new RustCounter(2147483647).add(1), /overflow/);
assert.throws(() => first.add('invalid'));
console.log('N-API addon: constructor, instance isolation, handle and errors passed');
