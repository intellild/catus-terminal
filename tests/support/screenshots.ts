import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

export function comparePng(expected: Buffer, actual: Buffer) {
  const a = PNG.sync.read(expected);
  const b = PNG.sync.read(actual);
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`Screenshot size changed: ${a.width}x${a.height} → ${b.width}x${b.height}`);
  }
  const diff = new PNG({ width: a.width, height: a.height });
  // Include font antialiasing pixels. Permit small color rounding differences,
  // but require zero perceptually different pixels, even for a single glyph.
  const changed = pixelmatch(a.data, b.data, diff.data, a.width, a.height, {
    threshold: 0.1,
    includeAA: true,
  });
  return { changed, diff: PNG.sync.write(diff), width: a.width, height: a.height };
}

export function colorPixels(bytes: Buffer, color: readonly number[]) {
  const image = PNG.sync.read(bytes);
  let count = 0;
  for (let index = 0; index < image.data.length; index += 4) {
    if (color.every((channel, offset) => image.data[index + offset] === channel)) {
      count++;
    }
  }
  return count;
}

export async function expectScreenshot(name: string, actual: Buffer) {
  const platform = `${process.platform}-${process.arch}`;
  const directory = path.resolve('tests/e2e/__screenshots__', platform);
  const artifacts = path.resolve('.tmp/e2e/artifacts');
  await mkdir(artifacts, { recursive: true });
  await writeFile(path.join(artifacts, `${name}.actual.png`), actual);
  const baseline = path.join(directory, `${name}.png`);
  if (process.env.CATUS_UPDATE_SCREENSHOTS === '1') {
    await mkdir(directory, { recursive: true });
    await writeFile(baseline, actual);
    return;
  }
  let expected: Buffer;
  try {
    expected = await readFile(baseline);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
    throw new Error(`Missing baseline ${baseline}. Run pnpm test:e2e:update and review the PNG.`, {
      cause: error,
    });
  }
  const result = comparePng(expected, actual);
  await writeFile(path.join(artifacts, `${name}.diff.png`), result.diff);
  await writeFile(
    path.join(artifacts, `${name}.json`),
    JSON.stringify({
      baseline,
      changed: result.changed,
      width: result.width,
      height: result.height,
    }),
  );
  if (result.changed !== 0) {
    throw new Error(`${name}: ${result.changed} changed pixels; see ${artifacts}`);
  }
}
