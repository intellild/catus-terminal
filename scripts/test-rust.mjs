import { spawnSync } from 'node:child_process';
import { rustRoot, rustTarget } from './rust-target.mjs';

for (const args of [
  ['fmt', '--manifest-path', `${rustRoot}/Cargo.toml`, '--check'],
  ['test', '--locked', '--manifest-path', `${rustRoot}/Cargo.toml`, '--target-dir', rustTarget],
  [
    'clippy',
    '--locked',
    '--manifest-path',
    `${rustRoot}/Cargo.toml`,
    '--target-dir',
    rustTarget,
    '--all-targets',
    '--',
    '-D',
    'warnings',
  ],
]) {
  const result = spawnSync('cargo', args, { stdio: 'inherit' });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
