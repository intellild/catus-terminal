import { rmSync } from 'node:fs';

// Turbo restores files over existing output. Remove stale chunks from earlier builds or dev runs.
for (const directory of ['../output/bundle/lynx/', '../dist/desktop/']) {
  rmSync(new URL(directory, import.meta.url), { recursive: true, force: true });
}
