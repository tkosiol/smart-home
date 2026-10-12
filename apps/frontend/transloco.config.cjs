// Translation key check of the app (pnpm i18n:check). The UI library has its own config in
// projects/ui; its keys (ui.*) are merged into the app's root translation at runtime.
module.exports = {
  rootTranslationsPath: 'src/i18n',
  langs: ['de', 'en'],
  keysManager: { input: ['src/app'], unflat: true, emitErrorOnExtraKeys: true },
};
