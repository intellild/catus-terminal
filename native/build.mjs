import { NapiCli } from '@napi-rs/cli';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyFile } from 'node:fs/promises';
import { rustTarget } from '../scripts/rust-target.mjs';

const packageRoot = fileURLToPath(new URL('.', import.meta.url));

export async function buildNative({ nativeView = true } = {}) {
  if (process.platform !== 'darwin') throw new Error('The native view currently supports macOS only');
  const outputDir = nativeView
    ? path.join(packageRoot, 'dist', process.platform, process.arch)
    : path.join(rustTarget, 'napi-smoke');
  const build = await new NapiCli().build({
    cwd: packageRoot,
    manifestPath: 'Cargo.toml',
    targetDir: rustTarget,
    outputDir,
    dts: 'index.d.ts',
    release: true,
    noDefaultFeatures: !nativeView,
    cargoOptions: ['--locked'],
  });
  await build.task;
  if (nativeView) {
    await copyFile(path.join(outputDir, 'index.d.ts'), path.join(packageRoot, 'index.d.ts'));
  }
  return path.join(outputDir, 'catus-native.node');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`Built ${await buildNative()}`);
}
