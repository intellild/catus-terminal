import { spawnSync } from 'node:child_process';
import { rustRoot, rustTarget } from './rust-target.mjs';

if (process.platform !== 'darwin') {
  throw new Error('Native terminal input tests require macOS');
}
const result = spawnSync(
  'cargo',
  [
    'test',
    '--locked',
    '--manifest-path',
    `${rustRoot}/Cargo.toml`,
    '--target-dir',
    rustTarget,
    '--features',
    'native-input-tests',
    '--test',
    'macos-input',
  ],
  { stdio: 'inherit' },
);
if (result.error) {
  throw result.error;
}
if (result.status !== 0) {
  throw new Error(`Rust native input tests failed: ${result.status}`);
}
