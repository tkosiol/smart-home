# @smart/ui

Design-System der Smart-Home-PWA: Theme-Laufzeit (`ThemeService`, `provideTheme`), Design-Tokens und die Komponenten auf Basis von Angular Material. Nur diese Bibliothek darf `@angular/material` und `@angular/cdk` verwenden und Komponenten-Styles enthalten.

Die Bibliothek wird weder separat gebaut noch veröffentlicht: Die App bindet sie über den Pfad-Alias `@smart/ui` (→ `projects/ui/src/public-api.ts`) direkt aus dem Quelltext ein.

| Zweck                   | Befehl                                                                                             |
| ----------------------- | -------------------------------------------------------------------------------------------------- |
| Unit-Tests (App und UI) | `pnpm --filter @smart/frontend test`                                                               |
| Storybook lokal         | `pnpm --filter @smart/frontend storybook`                                                          |
| Storybook-Checks (a11y) | `pnpm --filter @smart/frontend build-storybook && pnpm --filter @smart/frontend test-storybook:ci` |

Hintergrund: `docs/superpowers/specs/2026-10-11-etappe-3-design-system-design.md`.

## Bausteine

| Gruppe      | Komponenten                                                                                                     |
| ----------- | --------------------------------------------------------------------------------------------------------------- |
| Layout      | `ui-page`, `ui-section`, `ui-stack`, `ui-grid`                                                                  |
| Bedienung   | `ui-button`, `ui-icon-button`, `ui-switch`, `ui-segmented-button`, `ui-select`, `ui-chip-set`, `ui-color-field` |
| Inhalt      | `ui-card`, `ui-list`, `ui-list-item`, `ui-empty-state`, `ui-skeleton`, `ui-icon`                                |
| Formular    | `ui-text-field`                                                                                                 |
| Theme       | `ui-theme-editor` (Modi personal/instance), ThemeService, provideTheme                                          |
| Rückmeldung | `ui-banner`, `UiSnackbar`, `UiAnnouncer` (Services)                                                             |
| Zeit        | `uiDateTime`, `uiRelativeTime`, `UiFormatContext`, `UiClock`                                                    |

Neues Symbol: Namen in `src/lib/icon/icons.json` eintragen, dann `pnpm icons:build`.

## Texte und Sprache

Einfache Komponenten bekommen ihre Texte übersetzt vom Aufrufer (Inputs wie `label`, `heading`, `description`). Zusammengesetzte Komponenten wie `ui-theme-editor` bringen eigene Texte mit: Schlüssel unter `ui.*` in `src/i18n/de.json` und `en.json`. Die App und Storybook mischen sie über `loadUiTranslation(language)` in ihre Wurzelübersetzung.

- Schlüssel, die erst zur Laufzeit gewählt werden (z. B. Optionen aus einer Liste), mit `marker('ui.…')` aus `@jsverse/transloco-keys-manager/marker` markieren.
- `pnpm i18n:check` (Teil von `pnpm lint`) meldet fehlende und ungenutzte Schlüssel; ESLint (`smart/no-literal-template-text`) verbietet Text im Template ohne Schlüssel.
- Unit-Tests übersetzen mit `provideUiTranslocoTesting(language)` aus `src/lib/testing/i18n-testing.ts`.
