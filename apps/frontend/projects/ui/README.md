# @smart/ui

Design-System der Smart-Home-PWA: Theme-Laufzeit (`ThemeService`, `provideTheme`), Design-Tokens und die Komponenten auf Basis von Angular Material. Nur diese Bibliothek darf `@angular/material` und `@angular/cdk` verwenden und Komponenten-Styles enthalten.

Die Bibliothek wird weder separat gebaut noch veröffentlicht: Die App bindet sie über den Pfad-Alias `@smart/ui` (→ `projects/ui/src/public-api.ts`) direkt aus dem Quelltext ein.

Formularelemente (`UiSegmentedButton`, `UiChipSet`, `UiSelect`, `UiSwitch`, `UiColorField`, `UiTextField`, `normalizeHexColor`) und der `UiThemeEditor` liegen im zweiten Einstieg `@smart/ui/forms` (→ `projects/ui/src/forms.ts`). Alles andere kommt aus `@smart/ui`. Der Grund ist die Paketgröße: Alles, was `public-api.ts` weiterreicht und irgendwo verwendet wird, landet im Bundle der Shell. So bleibt Materials Auswahl-, Schalter- und Formular-Code in den lazy geladenen Seiten, die ihn brauchen. Material-lastige Bausteine, die nur lazy Seiten nutzen, gehören deshalb in `forms.ts`.

| Zweck                   | Befehl                                                                                             |
| ----------------------- | -------------------------------------------------------------------------------------------------- |
| Unit-Tests (App und UI) | `pnpm --filter @smart/frontend test`                                                               |
| Storybook lokal         | `pnpm --filter @smart/frontend storybook`                                                          |
| Storybook-Checks (a11y) | `pnpm --filter @smart/frontend build-storybook && pnpm --filter @smart/frontend test-storybook:ci` |

Hintergrund: `docs/superpowers/specs/2026-10-11-etappe-3-design-system-design.md`.

## Bausteine

| Gruppe      | Komponenten                                                                                                                     |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Layout      | `ui-page`, `ui-section`, `ui-stack`, `ui-grid`                                                                                  |
| Rahmen      | `ui-adaptive-shell` (Slots `uiShellTopBar`, `uiShellBanner`), `ui-top-app-bar` (Aktionen über `uiTopAppBarActions`), `ui-badge` |
| Bedienung   | `ui-button`, `ui-icon-button`, `ui-switch`, `ui-segmented-button`, `ui-select`, `ui-chip-set`, `ui-color-field`                 |
| Inhalt      | `ui-card`, `ui-list`, `ui-list-item`, `ui-empty-state`, `ui-skeleton`, `ui-icon`                                                |
| Formular    | `ui-text-field`                                                                                                                 |
| Theme       | `ui-theme-editor` (Modi personal/instance), ThemeService, provideTheme                                                          |
| Rückmeldung | `ui-banner`, `UiSnackbar`, `UiAnnouncer` (Services)                                                                             |
| Zeit        | `uiDateTime`, `uiRelativeTime`, `UiFormatContext`, `UiClock`                                                                    |

Neues Symbol: Namen in `src/lib/icon/icons.json` eintragen, dann `pnpm icons:build`.

## Verhalten

- **Link-Modus:** `ui-button` und `ui-icon-button` werden mit `route` zu einem Router-Link. Dann feuert `pressed` nicht; für Navigation den Link-Modus, für Aktionen `pressed` nehmen.
- **Snackbar:** `UiSnackbar.show(text, { action, politeness })`. Eine Meldung mit Aktion bleibt ohne Zeitlimit stehen, bis der Nutzer die Aktion auslöst oder sie über den Schließen-Knopf schließt. Ohne Aktion schließt sie sich nach 4 Sekunden. `politeness` ist `polite` (Standard) oder `assertive`.
- **Ansagen:** `UiAnnouncer.announce(text, politeness)` meldet Änderungen ohne Fokusziel an Screenreader, etwa einen Eintrag, der nach dem Speichern verschwindet.
- **Fensterklassen:** `ui-adaptive-shell` zeigt die Navigation unter 600 px als Leiste unten, von 600 bis 839 px als Rail und ab 840 px als Drawer. Die Ziele übergibt der Aufrufer als `UiNavDestination[]`.

## Bundle-Größe

Das initiale Bundle der App lag mit Etappe 3d bei rund 498 kB; die Grenze sind 500 kB (Build-Fehler, `angular.json`). Seit Etappe 4a lädt der `ThemeService` die Theme-Engine (`@smart/theme` mit `@material/material-color-utilities`, rund 50 kB) erst nach dem ersten Rendern als eigenen Chunk (`loadThemeEngine()`, `ThemeService.ready`); bis dahin bleibt das Theme aus `theme-boot.js` und dem Default-CSS stehen. Der Stand liegt jetzt bei rund 452 kB. Nur die engine-freie Auflösung (`resolveAppearance` aus `@smart/theme/resolve`) ist statisch importiert; `@smart/theme` selbst darf im Startpfad nur per `import()` vorkommen. Neuer Code, der beim Start geladen wird, braucht trotzdem zuerst Platz: lazy laden. Nutzen nur lazy Seiten einen Baustein, gehört er in `@smart/ui/forms`; `core/`, `shell/` und die App-Wurzel dürfen es per Lint nicht importieren.

## Texte und Sprache

Einfache Komponenten bekommen ihre Texte übersetzt vom Aufrufer (Inputs wie `label`, `heading`, `description`). Zusammengesetzte Komponenten wie `ui-theme-editor` bringen eigene Texte mit: Schlüssel unter `ui.*` in `src/i18n/de.json` und `en.json`. Die App und Storybook mischen sie über `loadUiTranslation(language)` in ihre Wurzelübersetzung.

- Schlüssel, die erst zur Laufzeit gewählt werden (z. B. Optionen aus einer Liste), mit `marker('ui.…')` aus `@jsverse/transloco-keys-manager/marker` markieren.
- `pnpm i18n:check` (Teil von `pnpm lint`) meldet fehlende und ungenutzte Schlüssel; ESLint (`smart/no-literal-template-text`) verbietet Text im Template ohne Schlüssel.
- Unit-Tests übersetzen mit `provideUiTranslocoTesting(language)` aus `src/lib/testing/i18n-testing.ts`.
