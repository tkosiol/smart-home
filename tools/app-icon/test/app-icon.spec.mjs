import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

const PUBLIC = join(import.meta.dirname, '../../../apps/frontend/public');
const SOURCE = join(import.meta.dirname, '../app-icon.svg');

const PNGS = [
  ['icons/icon-192.png', 192],
  ['icons/icon-512.png', 512],
  ['icons/apple-touch-icon.png', 180],
  ['icons/favicon-32.png', 32],
];

describe('app icon', () => {
  it.each(PNGS)('%s is a %i px square PNG', (file, size) => {
    const png = readFileSync(join(PUBLIC, file));
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
    // IHDR: width and height are big-endian uint32 at bytes 16-23.
    expect(png.readUInt32BE(16)).toBe(size);
    expect(png.readUInt32BE(20)).toBe(size);
  });

  it('publishes the source SVG unchanged as favicon.svg', () => {
    expect(readFileSync(join(PUBLIC, 'favicon.svg'), 'utf8')).toBe(readFileSync(SOURCE, 'utf8'));
  });

  it('fills the 512 px icon with the background colour up to the corner', () => {
    const png = readFileSync(join(PUBLIC, 'icons/icon-512.png'));
    const colorType = png[25];
    expect([2, 6]).toContain(colorType); // RGB or RGBA, 8 bit
    expect(png[24]).toBe(8);
    const data = [];
    for (let offset = 8; offset < png.length;) {
      const length = png.readUInt32BE(offset);
      if (png.toString('ascii', offset + 4, offset + 8) === 'IDAT') {
        data.push(png.subarray(offset + 8, offset + 8 + length));
      }
      offset += 12 + length;
    }
    // First scanline: one filter byte, then the first pixel. Left and up are zero there,
    // so every filter type leaves the first pixel's raw bytes unchanged.
    const first = inflateSync(Buffer.concat(data));
    expect([...first.subarray(1, 4)]).toEqual([0xd8, 0xf6, 0xff]);
  });
});
