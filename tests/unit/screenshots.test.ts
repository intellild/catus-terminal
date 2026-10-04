import { expect, test } from '@rstest/core';
import { PNG } from 'pngjs';
import { comparePng } from '../support/screenshots';

test('pixel comparison catches a missing glyph, a blank frame and size changes', () => {
  const image = new PNG({ width: 64, height: 32 });
  image.data.fill(255);
  // A glyph-sized dark patch on an otherwise identical background.
  for (let y = 4; y < 18; y++) {
    for (let x = 4; x < 12; x++) {
      const index = (y * image.width + x) * 4;
      image.data.set([20, 20, 20, 255], index);
    }
  }
  const expected = PNG.sync.write(image);
  expect(comparePng(expected, expected).changed).toBe(0);
  image.data.fill(255);
  expect(comparePng(expected, PNG.sync.write(image)).changed).toBe(112);
  image.data.fill(0);
  expect(comparePng(expected, PNG.sync.write(image)).changed).toBeGreaterThan(0);
  expect(() => comparePng(expected, PNG.sync.write(new PNG({ width: 32, height: 32 })))).toThrow(
    'Screenshot size changed',
  );
});
