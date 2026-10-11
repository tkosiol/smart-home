import { COLOR_ROLES, STATUS_NAMES } from '@smart/theme';
import { COLOR_GROUPS } from './color-roles.groups';

const swatches = COLOR_GROUPS.flatMap((group) => group.swatches);
const shownNames = new Set(swatches.flatMap((swatch) => [swatch.name, swatch.on?.name]));

describe('COLOR_GROUPS', () => {
  it('shows every Material color role as a fill or as text on a fill', () => {
    expect(COLOR_ROLES.filter((role) => !shownNames.has(role))).toEqual([]);
  });

  it('shows all four roles of every status color', () => {
    const expected = STATUS_NAMES.flatMap((name) => [
      name,
      `on-${name}`,
      `${name}-container`,
      `on-${name}-container`,
    ]);
    expect(expected.filter((role) => !shownNames.has(role))).toEqual([]);
  });

  it('writes every on-role on the fill it belongs to', () => {
    for (const swatch of swatches) {
      if (swatch.on?.name.startsWith('on-')) {
        expect(swatch.on.color, swatch.on.name).toContain(swatch.on.name);
      }
      expect(swatch.fill, swatch.name).toContain(swatch.name);
    }
  });

  it('pairs container roles with their own on-role', () => {
    const container = swatches.find((swatch) => swatch.name === 'primary-container');
    expect(container?.on?.name).toBe('on-primary-container');
  });
});
