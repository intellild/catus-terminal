import { readFile, writeFile } from 'node:fs/promises';
import { Resvg } from '@resvg/resvg-js';

const resources = new URL('../resources/', import.meta.url);
const svg = await readFile(new URL('catus.svg', resources), 'utf8');
const images = new Map();

function png(size) {
  if (!images.has(size)) {
    images.set(size, new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng());
  }
  return images.get(size);
}

// ICNS carries PNG representations for standard and Retina icon sizes.
const representations = [
  ['icp4', 16],
  ['icp5', 32],
  ['icp6', 64],
  ['ic07', 128],
  ['ic08', 256],
  ['ic09', 512],
  ['ic10', 1024],
  ['ic11', 32],
  ['ic12', 64],
  ['ic13', 256],
  ['ic14', 512],
];
const chunks = representations.map(([type, size]) => {
  const data = png(size);
  const header = Buffer.alloc(8);
  header.write(type, 0, 'ascii');
  header.writeUInt32BE(header.length + data.length, 4);
  return Buffer.concat([header, data]);
});
const icnsHeader = Buffer.alloc(8);
icnsHeader.write('icns', 0, 'ascii');
icnsHeader.writeUInt32BE(8 + chunks.reduce((total, chunk) => total + chunk.length, 0), 4);

// ICO directory entries point at PNG images; zero denotes a 256px dimension.
const sizes = [16, 24, 32, 48, 64, 128, 256];
const icoHeader = Buffer.alloc(6 + sizes.length * 16);
icoHeader.writeUInt16LE(1, 2);
icoHeader.writeUInt16LE(sizes.length, 4);
let offset = icoHeader.length;
for (const [index, size] of sizes.entries()) {
  const data = png(size);
  const entry = 6 + index * 16;
  icoHeader.writeUInt8(size === 256 ? 0 : size, entry);
  icoHeader.writeUInt8(size === 256 ? 0 : size, entry + 1);
  icoHeader.writeUInt16LE(1, entry + 4);
  icoHeader.writeUInt16LE(32, entry + 6);
  icoHeader.writeUInt32LE(data.length, entry + 8);
  icoHeader.writeUInt32LE(offset, entry + 12);
  offset += data.length;
}

await writeFile(new URL('catus.png', resources), png(1024));
await writeFile(new URL('catus.icns', resources), Buffer.concat([icnsHeader, ...chunks]));
await writeFile(new URL('catus.ico', resources), Buffer.concat([icoHeader, ...sizes.map(png)]));
console.log('Generated resources/catus.png, catus.icns and catus.ico from catus.svg');
