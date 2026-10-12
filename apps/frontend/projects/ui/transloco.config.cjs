// Translation key check of @smart/ui (pnpm i18n:check). All keys live under "ui." so they cannot
// clash with app keys when both files are merged into one root translation.
module.exports = {
  rootTranslationsPath: 'src/i18n',
  langs: ['de', 'en'],
  keysManager: { input: ['src/lib'], unflat: true, emitErrorOnExtraKeys: true },
};
