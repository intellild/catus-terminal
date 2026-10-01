import { rmSync } from 'node:fs';

// A previous test/dev run can leave a readiness marker. Wait for this run's bundle.
rmSync(new URL('../.tmp/dev-ready.rspeedy.json', import.meta.url), { force: true });
