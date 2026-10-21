import { expect, test } from '@rstest/core';
import { readFile, writeFile } from 'node:fs/promises';
import { LynxApp, waitFor } from '../support/lynx';
import { colorPixels } from '../support/screenshots';

test('dock plus opens the host editor and its Select after repeated mounts', async () => {
  const app = new LynxApp();
  const logPath = '.tmp/e2e/artifacts/lynxtron.log';
  let logOffset: number;
  try {
    await app.start({ windowless: false });
    logOffset = (await readFile(logPath, 'utf8')).length;
    for (let attempt = 0; attempt < 2; attempt++) {
      await app.automation('open-settings').tap();
      await app.automation('add-host').tap();
      await app.automation('profile-shell').visibleTarget();
      expect(await app.automation('profile-name').invoke<string>('getValue')).toBe('New host');
      const normal = await app.automation('profile-name-group').screenshot();
      await app.automation('profile-name').invoke('focus');
      const focused = await waitFor('InputGroup focus border', async () => {
        const image = await app.automation('profile-name-group').screenshot();
        return colorPixels(image, [168, 230, 207]) > colorPixels(normal, [168, 230, 207]) + 100
          ? image
          : undefined;
      });
      await writeFile('.tmp/e2e/artifacts/input-group-focused.png', focused);
      await app.automation('profile-name').invoke('blur');
      await waitFor('InputGroup blur border', async () => {
        const group = await app.automation('profile-name-group').node();
        return group && app.attribute(group, 'class')?.includes('border-[#39444e]')
          ? true
          : undefined;
      });
      const name = `Input regression ${attempt}`;
      await app.automation('profile-name').invoke('setValue', { value: name });
      expect(await app.automation('profile-name').invoke<string>('getValue')).toBe(name);
      await app.automation('profile-shell').tap();
      await app.automation('profile-shell-option-1').visibleTarget();
      await app.tap('.profile-shell-dismiss');
      await app.automation('save-host').invoke('scrollIntoView', {
        scrollIntoViewOptions: { block: 'center', inline: 'center', behavior: 'none' },
      });
      await app.automation('save-host').tap();
      // Saving keeps the settings dialog open on the updated host.
      await app.automation('close-settings').tap();
      const id = `host-${attempt + 1}`;
      await waitFor('saved host', () => app.automation(`host-${id}`).node());
      await app.automation('open-settings').tap();
      await app.automation(`settings-host-${id}`).tap();
      await app.automation('profile-name').visibleTarget();
      expect(await app.automation('profile-name').invoke<string>('getValue')).toBe(name);
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
