import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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

  describe('rendering', () => {
    let browser;
    beforeAll(async () => {
      browser = await chromium.launch();
    });
    afterAll(async () => {
      await browser?.close();
    });

    it('fills the 512 px icon with the background colour up to the corner', async () => {
      const png = readFileSync(join(PUBLIC, 'icons/icon-512.png')).toString('base64');
      const page = await browser.newPage();
      const pixel = await page.evaluate(async (data) => {
        const img = new globalThis.Image();
        img.src = `data:image/png;base64,${data}`;
        await img.decode();
        const canvas = globalThis.document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const context = canvas.getContext('2d');
        context.drawImage(img, 0, 0);
        return [...context.getImageData(0, 0, 1, 1).data];
      }, png);
      await page.close();
      expect(pixel).toEqual([0xd8, 0xf6, 0xff, 0xff]);
    });
  });
});
