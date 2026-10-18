import { expect, test } from '@rstest/core';
import { readFile } from 'node:fs/promises';
import { LynxApp } from '../support/lynx';

test('dock plus opens the workspace editor and its Select after repeated mounts', async () => {
  const app = new LynxApp();
  const logPath = '.tmp/e2e/artifacts/lynxtron.log';
  let logOffset: number;
  try {
    await app.start({ windowless: false });
    logOffset = (await readFile(logPath, 'utf8')).length;
    for (let attempt = 0; attempt < 2; attempt++) {
      await app.automation('add-workspace').tap();
      await app.automation('profile-shell').visibleTarget();
      await app.automation('profile-shell').tap();
      await app.automation('profile-shell-option-1').visibleTarget();
      await app.tap('.profile-shell-dismiss');
      await app.automation('close-settings').tap();
    }
    expect(await app.sessionExists(1)).toBe(true);
  } finally {
    await app.close();
  }
  const errors = (await readFile(logPath, 'utf8'))
    .slice(logOffset)
    .split('\n')
    .filter(
      (line) =>
        line.includes('Call exception:') || line.includes('JSErrorReporter::reportException'),
    );
  expect(errors).toEqual([]);
});
