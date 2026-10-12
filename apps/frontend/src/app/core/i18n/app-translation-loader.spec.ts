import { loadUiTranslation } from '@smart/ui';
import appDe from '../../../i18n/de.json';
import appEn from '../../../i18n/en.json';
import { AppTranslationLoader } from './app-translation-loader';

describe('AppTranslationLoader', () => {
  it('merges the app and library texts of a language', async () => {
    const loader = new AppTranslationLoader();
    await expect(loader.getTranslation('de')).resolves.toEqual({
      ...appDe,
      ...(await loadUiTranslation('de')),
    });
    await expect(loader.getTranslation('en')).resolves.toEqual({
      ...appEn,
      ...(await loadUiTranslation('en')),
    });
  });

  it('falls back to German for a language it does not know', async () => {
    const loader = new AppTranslationLoader();
    await expect(loader.getTranslation('fr')).resolves.toEqual(await loader.getTranslation('de'));
  });
});
