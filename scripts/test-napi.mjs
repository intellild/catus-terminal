import assert from 'node:assert/strict';
import { verifySftp } from '../tests/native/sftp.mjs';
import { buildNative } from '../native/build.mjs';

// Build through napi-rs with the view disabled for this isolated Node process.
// The application artifact keeps the C++ view and is verified in Lynxtron.
const binary = await buildNative({ nativeView: false });
const addon = { exports: {} };
process.dlopen(addon, binary);
const {
  createTerminalSession,
  closeTerminalSession,
  writeTerminalSession,
  getTerminalSessionInfo,
} = addon.exports;
// Exercise the numeric session API used by TerminalView's mount/unmount lifecycle.
const id = 41;
assert.throws(
  () => createTerminalSession(id, { program: '/nonexistent/catus-test-shell', args: [] }),
  (error) => {
    assert.match(error.message, /Spawn terminal process \/nonexistent\/catus-test-shell/);
    assert.match(error.message, /No such file|not found/i);
    return true;
  },
);
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

await verifySftp(addon.exports.connectSftp);
