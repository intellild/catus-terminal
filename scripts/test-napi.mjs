import assert from 'node:assert/strict';
import { buildNative } from '../native/build.mjs';

// Build through napi-rs with the view disabled for this isolated Node process.
// The application artifact keeps the C++ view and is verified in Lynxtron.
const binary = await buildNative({ nativeView: false });
const addon = { exports: {} };
process.dlopen(addon, binary);
const {
  RustCounter,
  createTerminalSession,
  closeTerminalSession,
  writeTerminalSession,
  getTerminalSessionInfo,
} = addon.exports;
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

// Exercise the numeric session API used by TerminalView's mount/unmount lifecycle.
const id = 41;
assert.equal(createTerminalSession(id), undefined);
try {
  assert.ok(Number.isInteger(id) && id > 0 && id <= 0xffffffff);
  assert.ok(getTerminalSessionInfo(id).shell.startsWith('/'));
  assert.throws(() => createTerminalSession(id), /Duplicate/);
  assert.throws(() => createTerminalSession(0), /reserved/);
  writeTerminalSession(id, "printf '%s%s\\n' NAPI_ PTY_OK\r");
  const deadline = Date.now() + 10_000;
  while (!getTerminalSessionInfo(id).text.includes('NAPI_PTY_OK')) {
    assert.ok(Date.now() < deadline, getTerminalSessionInfo(id).text);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
} finally {
  closeTerminalSession(id);
}
assert.throws(() => getTerminalSessionInfo(id), /released/);
assert.throws(() => writeTerminalSession(id, 'x'), /released/);
closeTerminalSession(id); // Idempotent cleanup.
createTerminalSession(id); // Reuse is allowed only after removal.
assert.ok(getTerminalSessionInfo(id).shell.startsWith('/'));
closeTerminalSession(id);
assert.throws(() => getTerminalSessionInfo(0), /Unknown/);
console.log('N-API terminal: numeric session ID, default shell, PTY output and release passed');
