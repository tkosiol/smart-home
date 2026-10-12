import de from '../../i18n/de.json';
import en from '../../i18n/en.json';
import { loadUiTranslation } from './ui-translations';

describe('loadUiTranslation', () => {
  it('loads the library texts of each language', async () => {
    await expect(loadUiTranslation('de')).resolves.toEqual(de);
    await expect(loadUiTranslation('en')).resolves.toEqual(en);
  });

  it('keeps every library key below "ui" so it cannot clash with app keys', () => {
    for (const translation of [de, en]) {
      expect(Object.keys(translation).filter((key) => key !== 'ui')).toEqual([]);
    }
  });
});
