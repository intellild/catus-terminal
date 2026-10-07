import { NapiCli } from '@napi-rs/cli';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { rustTarget } from '../scripts/rust-target.mjs';

const packageRoot = fileURLToPath(new URL('.', import.meta.url));

export async function buildNative({ nativeView = true } = {}) {
  if (process.platform !== 'darwin') {
    throw new Error('The native view currently supports macOS only');
  }
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
    const declarations = path.join(packageRoot, 'index.d.ts');
    await copyFile(path.join(outputDir, 'index.d.ts'), declarations);
    // Keep generated declarations consistent with the project's formatting checks.
    const require = createRequire(import.meta.url);
    const rstackCLI = path.join(path.dirname(require.resolve('rstack/package.json')), 'bin/rs.js');
    execFileSync(process.execPath, [rstackCLI, 'format', declarations], {
      cwd: path.dirname(packageRoot),
      stdio: 'inherit',
    });
  }
  return path.join(outputDir, 'catus-native.node');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`Built ${await buildNative()}`);
}
