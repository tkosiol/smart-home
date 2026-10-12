import { readFileSync } from 'node:fs';
import * as fontkit from 'fontkit';
import { describe, expect, it } from 'vitest';
import { PATHS, buildIconFont, renderCodepoints } from '../build-icon-font.mjs';

const source = readFileSync(PATHS.source);

describe('buildIconFont', () => {
  it('maps icon names to their Material Symbols codepoints', async () => {
    const { codepoints } = await buildIconFont(['check', 'home'], source);
    expect(codepoints).toEqual({ check: 0xe5ca, home: 0xe88a });
  });

  it('rejects names that are not Material Symbols', async () => {
    await expect(buildIconFont(['home', 'not_an_icon'], source)).rejects.toThrow(
      'Unknown Material Symbols: not_an_icon',
    );
  });

  it('keeps only the listed glyphs and the FILL axis', async () => {
    const { font, codepoints } = await buildIconFont(['check', 'home'], source);
    const subset = fontkit.create(font);
    expect(Object.keys(subset.variationAxes)).toEqual(['FILL']);
    expect(subset.hasGlyphForCodePoint(codepoints.home)).toBe(true);
    expect(subset.hasGlyphForCodePoint(0xe145)).toBe(false); // "add" was not requested
    expect(font.length).toBeLessThan(10_000);
  });

  it('has a sorted list without duplicates', () => {
    const names = JSON.parse(readFileSync(PATHS.names, 'utf8'));
    expect(names).toEqual([...new Set(names)].sort());
  });

  it('committed font and codepoints are up to date (run: pnpm icons:build)', async () => {
    const names = JSON.parse(readFileSync(PATHS.names, 'utf8'));
    const { font, codepoints } = await buildIconFont(names, source);
    expect(readFileSync(PATHS.codepoints, 'utf8')).toBe(renderCodepoints(codepoints));
    expect(Buffer.compare(readFileSync(PATHS.font), font)).toBe(0);
  });
});
