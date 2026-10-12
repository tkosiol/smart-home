import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const OUT = join(import.meta.dirname, '../../apps/frontend/public');
const SIZES = [
  ['icons/icon-192.png', 192],
  ['icons/icon-512.png', 512],
  ['icons/apple-touch-icon.png', 180],
  ['icons/favicon-32.png', 32],
];

export async function generate() {
  const svg = await readFile(join(import.meta.dirname, 'app-icon.svg'), 'utf8');
  await mkdir(join(OUT, 'icons'), { recursive: true });
  await writeFile(join(OUT, 'favicon.svg'), svg);
  const browser = await chromium.launch();
  try {
    for (const [file, size] of SIZES) {
      const page = await browser.newPage({ viewport: { width: size, height: size } });
      await page.setContent(
        `<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
      );
      await writeFile(join(OUT, file), await page.screenshot({ type: 'png' }));
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await generate();
