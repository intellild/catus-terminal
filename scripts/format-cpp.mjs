import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const check = process.argv.includes('--check');
if (process.argv.slice(2).some((argument) => argument !== '--check')) {
  throw new Error('Usage: node scripts/format-cpp.mjs [--check]');
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(result.stderr || `${command} failed: ${result.status}`);
  }
  return result.stdout;
}

let formatter = process.env.CLANG_FORMAT || 'clang-format';
const probe = spawnSync(formatter, ['--version'], { encoding: 'utf8' });
if (probe.error?.code === 'ENOENT' && !process.env.CLANG_FORMAT && process.platform === 'darwin') {
  formatter = run('xcrun', ['--find', 'clang-format']).trim();
} else if (probe.error || probe.status !== 0) {
  throw new Error('clang-format is unavailable. Install it or set CLANG_FORMAT to its executable.');
}

// Include tracked and new sources; Git excludes dependencies and generated output.
const files = run('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
  .split('\0')
  .filter((file) => /\.(?:c|cc|cpp|cxx|h|hh|hpp|hxx|m|mm)$/.test(file))
  .filter((file) => existsSync(join(root, file)) && lstatSync(join(root, file)).isFile())
  .filter((file) => !/(?:^|\/)(?:node_modules|dist|output|target|build|\.tmp)(?:\/|$)/.test(file));
for (let start = 0; start < files.length; start += 50) {
  const result = spawnSync(
    formatter,
    [
      '--style=file',
      ...(check ? ['--dry-run', '--Werror'] : ['-i']),
      ...files.slice(start, start + 50),
    ],
    { cwd: root, stdio: 'inherit' },
  );
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
console.log(`${check ? 'Checked' : 'Formatted'} ${files.length} C/C++/Objective-C source files.`);
