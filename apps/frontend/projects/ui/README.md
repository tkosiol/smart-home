# @smart/ui

Design-System der Smart-Home-PWA: Theme-Laufzeit (`ThemeService`, `provideTheme`), Design-Tokens und die Komponenten auf Basis von Angular Material. Nur diese Bibliothek darf `@angular/material` und `@angular/cdk` verwenden und Komponenten-Styles enthalten.

Die Bibliothek wird weder separat gebaut noch veröffentlicht: Die App bindet sie über Pfad-Aliasse direkt aus dem Quelltext ein. Es gibt drei Einstiege:

| Einstieg          | Datei                           | Wer importiert ihn                                                                                                                                               |
| ----------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@smart/ui/shell` | `projects/ui/src/shell.ts`      | Startcode: App-Wurzel, `core/`, `shell/` (Theme, Icon, Button, Banner, Badge, Rahmen, Snackbar, Zeit)                                                            |
| `@smart/ui`       | `projects/ui/src/public-api.ts` | Lazy Seiten: `export * from './shell'` plus Layout, Karten, Listen, Leerzustand, Skeleton, Zeit-Pipes                                                            |
| `@smart/ui/forms` | `projects/ui/src/forms.ts`      | Lazy Seiten: Formularelemente (`UiSegmentedButton`, `UiChipSet`, `UiSelect`, `UiSwitch`, `UiColorField`, `UiTextField`, `normalizeHexColor`) und `UiThemeEditor` |

Der Grund ist die Paketgröße: esbuild ordnet ganze Dateien einem Chunk zu. Ein Barrel, den der Startcode importiert, hat für jede Datei, die er weiterreicht, einen Import; wird eine davon irgendwo (auch nur von einer lazy Seite) verwendet, landet sie im initialen Bundle. Deshalb importiert Startcode nur `@smart/ui/shell`, nie `@smart/ui` (Lint: `no-restricted-imports`, Ausnahme `shell/not-found.ts`, eine lazy Seite, und Specs) und nie `@smart/ui/forms`. In `shell.ts` gehört nur, was Startcode tatsächlich braucht; alles andere nur in `public-api.ts` oder `forms.ts`. Ein neuer Baustein, den nur lazy Seiten nutzen, kann so nicht versehentlich ins initiale Bundle geraten.

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

## Instanz-Theme

Das Instanz-Theme gehört dem Server. Vorrang (Spec 3.8): Wert des Servers, `config.json` (`provideTheme({ instance })`), Build-Standard. Der Browser hält nur eine Kopie des Server-Werts (für den Start ohne Netz); die App holt den Wert beim Start und übergibt ihn mit `ThemeService.adoptInstance(value)` (`null`: auf dem Server ist nichts gespeichert). `adoptInstance` benachrichtigt niemanden. Änderungen im Editor (`setInstance`, `resetInstance`) speichern die Kopie und rufen die Hörer aus `onInstanceChange(listener)` (`resetInstance` meldet `null`); die App schickt sie an den Server. Gleiches Muster wie `adoptPersonal` und `onPersonalChange`.

## Bundle-Größe

Das initiale Bundle der App lag mit Etappe 3d bei rund 498 kB. Seit Etappe 4a lädt der `ThemeService` die Theme-Engine (`@smart/theme` mit `@material/material-color-utilities`, rund 50 kB) erst nach dem ersten Rendern als eigenen Chunk (`loadThemeEngine()`, `ThemeService.ready`); bis dahin bleibt das Theme aus `theme-boot.js` und dem Default-CSS stehen. Nur die engine-freie Auflösung (`resolveAppearance` aus `@smart/theme/resolve`) ist statisch importiert; `@smart/theme` selbst darf im Startpfad nur per `import()` vorkommen. Mit dem Einstieg `@smart/ui/shell` (siehe oben) sank der Stand von rund 481,7 kB (Etappe 4c) auf rund 469,1 kB, weil lazy Seiten keine UI-Dateien mehr in den Startpfad ziehen. Die Grenze im Build (`angular.json`) liegt bei 480 kB (Fehler) und 400 kB (Warnung).

Nicht abgedeckt: Symbole aus `@angular/core`, die nur lazy Seiten nutzen, können trotzdem im Startpfad landen (gemessen: `resource()` rund 6,5 kB, `httpResource()` rund 31 kB). Nach neuen solchen Importen `pnpm build` ausführen und die Größe prüfen. Neuer Code, der beim Start geladen wird, braucht zuerst Platz: lazy laden.

## Texte und Sprache

Einfache Komponenten bekommen ihre Texte übersetzt vom Aufrufer (Inputs wie `label`, `heading`, `description`). Zusammengesetzte Komponenten wie `ui-theme-editor` bringen eigene Texte mit: Schlüssel unter `ui.*` in `src/i18n/de.json` und `en.json`. Die App und Storybook mischen sie über `loadUiTranslation(language)` in ihre Wurzelübersetzung.

- Schlüssel, die erst zur Laufzeit gewählt werden (z. B. Optionen aus einer Liste), mit `marker('ui.…')` aus `@jsverse/transloco-keys-manager/marker` markieren.
- `pnpm i18n:check` (Teil von `pnpm lint`) meldet fehlende und ungenutzte Schlüssel; ESLint (`smart/no-literal-template-text`) verbietet Text im Template ohne Schlüssel.
- Unit-Tests übersetzen mit `provideUiTranslocoTesting(language)` aus `src/lib/testing/i18n-testing.ts`.
