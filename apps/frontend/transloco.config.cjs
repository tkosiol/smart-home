// Translation key check of the app (pnpm i18n:check). The UI library has its own config in
// projects/ui; its keys (ui.*) are merged into the app's root translation at runtime.
// Each feature has its own scope (lazily loaded with its routes); the wrapper checks that the
// folders below exist and contain de.json and en.json.
module.exports = {
  rootTranslationsPath: 'src/i18n',
  langs: ['de', 'en'],
  scopePathMap: {
    dashboard: 'src/app/features/dashboard/i18n',
    rooms: 'src/app/features/rooms/i18n',
    devices: 'src/app/features/devices/i18n',
    more: 'src/app/features/more/i18n',
    settings: 'src/app/features/settings/i18n',
    auth: 'src/app/features/auth/i18n',
    households: 'src/app/features/households/i18n',
  },
  keysManager: { input: ['src/app'], unflat: true, emitErrorOnExtraKeys: true },
};
