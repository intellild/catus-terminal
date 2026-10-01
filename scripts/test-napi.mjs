import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { rustRoot, rustTarget } from './rust-target.mjs';

// Link just the Rust archive with the same Apple linker used by CMake. The app loads
// only the combined .node through AutoLink, so it keeps a single registry.
const binary = `${rustTarget}/release/catus-rust-smoke.node`;
const linked = spawnSync('/usr/bin/c++', ['-bundle', '-undefined', 'dynamic_lookup',
  `-Wl,-force_load,${rustTarget}/release/libcatus_rust.a`,
  `${rustRoot}/../lynxtron/library_entry.cc`, '-o', binary], { stdio: 'inherit' });
if (linked.error) throw linked.error;
if (linked.status !== 0) process.exit(linked.status ?? 1);
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
