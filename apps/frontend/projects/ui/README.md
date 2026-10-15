# @smart/ui

Design-System der Smart-Home-PWA: Theme-Laufzeit (`ThemeService`, `provideTheme`), Design-Tokens und die Komponenten auf Basis von Angular Material. Nur diese Bibliothek darf `@angular/material` und `@angular/cdk` verwenden und Komponenten-Styles enthalten.

Die Bibliothek wird weder separat gebaut noch veröffentlicht: Die App bindet sie über Pfad-Aliasse direkt aus dem Quelltext ein. Es gibt drei Einstiege:

| Einstieg          | Datei                           | Wer importiert ihn                                                                                                                                                                |
| ----------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@smart/ui/shell` | `projects/ui/src/shell.ts`      | Startcode: App-Wurzel, `core/`, `shell/` (Theme, Icon, Button, Banner, Badge, Rahmen, Snackbar, Zeit)                                                                             |
| `@smart/ui`       | `projects/ui/src/public-api.ts` | Lazy Seiten: `export * from './shell'` plus Layout, Karten, Listen, Leerzustand, Skeleton, Zeit-Pipes                                                                             |
| `@smart/ui/forms` | `projects/ui/src/forms.ts`      | Lazy Seiten: Formularelemente (`UiSegmentedButton`, `UiChipSet`, `UiSelect`, `UiSwitch`, `UiColorField`, `UiTextField`, `normalizeHexColor`), `UiReorderList` und `UiThemeEditor` |

Der Grund ist die Paketgröße: esbuild ordnet ganze Dateien einem Chunk zu. Ein Barrel, den der Startcode importiert, hat für jede Datei, die er weiterreicht, einen Import; wird eine davon irgendwo (auch nur von einer lazy Seite) verwendet, landet sie im initialen Bundle. Deshalb importiert Startcode nur `@smart/ui/shell`, nie `@smart/ui` (Lint: `no-restricted-imports`, Ausnahme `shell/not-found.ts`, eine lazy Seite, und Specs) und nie `@smart/ui/forms`. In `shell.ts` gehört nur, was Startcode tatsächlich braucht; alles andere nur in `public-api.ts` oder `forms.ts`. Ein neuer Baustein, den nur lazy Seiten nutzen, kann so nicht versehentlich ins initiale Bundle geraten.

| Zweck                   | Befehl                                                                                             |
| ----------------------- | -------------------------------------------------------------------------------------------------- |
| Unit-Tests (App und UI) | `pnpm --filter @smart/frontend test`                                                               |
| Storybook lokal         | `pnpm --filter @smart/frontend storybook`                                                          |
| Storybook-Checks (a11y) | `pnpm --filter @smart/frontend build-storybook && pnpm --filter @smart/frontend test-storybook:ci` |

Hintergrund: `docs/superpowers/specs/2026-10-11-etappe-3-design-system-design.md`.

## Bausteine

| Gruppe      | Komponenten                                                                                                                        |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Layout      | `ui-page`, `ui-section`, `ui-stack`, `ui-grid`                                                                                     |
| Rahmen      | `ui-adaptive-shell` (Slots `uiShellTopBar`, `uiShellBanner`), `ui-top-app-bar` (Aktionen über `uiTopAppBarActions`), `ui-badge`    |
| Bedienung   | `ui-button`, `ui-icon-button`, `ui-switch`, `ui-segmented-button`, `ui-select`, `ui-chip-set`, `ui-color-field`, `ui-reorder-list` |
| Inhalt      | `ui-card`, `ui-list`, `ui-list-item`, `ui-empty-state`, `ui-skeleton`, `ui-icon`, `ui-value-display`, `ui-progress-band`           |
| Status      | `ui-status-hero`, `ui-status-entry`, `ui-device-pod`, `ui-pod-row`                                                                 |
| Sheet       | `UiBottomSheet` (Service), `ui-sheet` (Rahmen), `UI_SHEET_DATA`, `UiSheetRef`                                                      |
| Formular    | `ui-text-field`                                                                                                                    |
| Theme       | `ui-theme-editor` (Modi personal/instance), ThemeService, provideTheme                                                             |
| Rückmeldung | `ui-banner`, `UiSnackbar`, `UiAnnouncer` (Services)                                                                                |
| Zeit        | `uiDateTime`, `uiRelativeTime`, `UiFormatContext`, `UiClock`                                                                       |

Neues Symbol: Namen in `src/lib/icon/icons.json` eintragen, dann `pnpm icons:build`.

## Tokens der Designsprache

Designkonzept Abschnitt 2 (`docs/superpowers/specs/2026-10-15-designkonzept-design.md`); feste Längen nur in `src/lib/tokens/`.

| Datei            | Tokens                                                                                                                                                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shape.css`      | Formzuordnung: `--smart-shape-card` (Karten, extra-large), `--smart-shape-pod` (Pods und Einträge, large), `--smart-shape-control` (Chips, Pillen, Schalter, Icon-Buttons, full), `--smart-shape-bar` (Diagrammbalken, extra-small)               |
| `typography.css` | `--smart-font-weight-medium` (500), `--smart-font-weight-semibold` (600), `--smart-type-value-hero` (80/84 px, 600) mit `--smart-type-tracking-hero` (−0,03 em), `--smart-type-tracking-tight` (Titel), `--smart-type-tracking-label` (Versalien) |
| `layout.css`     | `--smart-size-pod-width` (140 px), `--smart-size-pod-height` (116 px), `--smart-size-icon-container` (40 px), `--smart-size-progress-band` (12 px), `--smart-size-top-app-bar-large` (72 px), `--smart-motion-scale-pressed` (0,98)               |

Farbfamilien (`UiTone` in `src/lib/tone.ts`) rendern Komponenten als `data-tone`; die Regeln dazu liefert `src/lib/_tone.scss` (`tone.fill` für alle Flächen, `tone.strong` und `tone.container` für je eine Hälfte, `tone.text` für Text). Neue Bausteine nehmen diese Mixins statt eigener Farbtabellen; wer nur Container braucht (Chips, Icon-Container), nimmt `tone.container`, denn jede Verwendung von `fill` kostet rund 2,5 kB Komponenten-CSS (Budget 4 kB je Komponente). Ein Baustein mit fester Farbtabelle (die fünf Pod-Fills aus Designkonzept 2.4) schreibt seine Regeln aus.

**Stories in allen Kombinationen:** Jeder neue oder geänderte Baustein hat eine Story „Kombinationen“ mit `ui-theme-matrix` (`src/lib/testing/theme-matrix.story-component.ts`): Sie rendert die Zelle in zwei Grundfarben (Standard und `#d32f2f`) × hell/dunkel × Standard/Mittel/Hoch, jede Zelle mit den Variablen der Theme-Engine, und axe prüft alle zwölf in einem Lauf (`expectThemeMatrix`).

## Verhalten

- **Link-Modus:** `ui-button` und `ui-icon-button` werden mit `route` zu einem Router-Link. Dann feuert `pressed` nicht; für Navigation den Link-Modus, für Aktionen `pressed` nehmen.
- **Snackbar:** `UiSnackbar.show(text, { action, politeness })`. Eine Meldung mit Aktion bleibt ohne Zeitlimit stehen, bis der Nutzer die Aktion auslöst oder sie über den Schließen-Knopf schließt. Ohne Aktion schließt sie sich nach 4 Sekunden. `politeness` ist `polite` (Standard) oder `assertive`.
- **Ansagen:** `UiAnnouncer.announce(text, politeness)` meldet Änderungen ohne Fokusziel an Screenreader, etwa einen Eintrag, der nach dem Speichern verschwindet (Details unten).
- **Fensterklassen:** `ui-adaptive-shell` zeigt die Navigation unter 600 px als Leiste unten, von 600 bis 839 px als Rail und ab 840 px als Drawer. Die Ziele übergibt der Aufrufer als `UiNavDestination[]`.
- **Top App Bar:** `size="large"` zeigt den Titel groß (`headline-small`, Gewicht 600) auf einer 72 px hohen Leiste – für Compact (Designkonzept 3.1). Die Leiste beobachtet den Viewport nicht; der Aufrufer wählt die Größe je Fensterklasse.
- **Tonale Icon-Buttons:** `ui-icon-button` mit `variant="tonal"` sitzt auf einer `surface-container-high`-Scheibe (Top App Bar, Geräteseite). Die Scheibe ist 48 px groß und selbst das Touch-Ziel.
- **Icon-Container in Listen:** `ui-list-item` mit `leadingTone` legt das Icon in einen runden 40-px-Container in einer Farbfamilie (`UiTone`): Rolle oder Statusfarbe, jeweils als kräftige Fläche (`error`) oder Container (`ok-container`), oder `surface`. Der Container ist dekorativ (`aria-hidden`); der Eintrag heißt nach seinen Texten.
- **Chips mit Zähler:** `ui-chip-set` nimmt `UiChipOption` mit `count`; der Zähler steht hinter dem Label und gehört zum Namen der Option („Kritisch 2“). `multiple` (Standard) erlaubt mehrere Chips zugleich.
- **Werte:** `ui-value-display` zeigt `value` (vom Aufrufer formatiert), `unit` und `label` in `size` `hero` (Hauptwert der Geräteseite, `--smart-type-value-hero`), `large` oder `medium` (Pods, Nebenwerte), immer mit Tabellenziffern. Ohne `tone` erben Wert und Label ihre Farbe von der Fläche (auch auf `primary` oder `secondary-container`); mit `tone` (`UiToneName`) nehmen sie die kräftige Farbe der Familie. Das Label des Hero steht vor dem Wert, bei den anderen Größen danach – im DOM wie auf dem Bildschirm.
- **Status-Hero:** `ui-status-hero` ist eine `region` mit Überschrift (Designkonzept 4.1). `tone` `attention` (`primary-container`) oder `critical` (`error-container`, Regel 6) zeigt den Kopf „{heading} · {count}“, rechts „{k} kritisch“ nur bei `criticalCount` > 0, darunter die projizierten `ui-status-entry` (der Aufrufer begrenzt auf drei, Regel 5) und immer die Pille „Alle {count} Hinweise“ zu `moreRoute`, daneben `moreLabel` („3 weitere Gruppen“). `tone="calm"` ist die 56-px-Ruhezeile (Regel 7): ok-Icon-Container, „Alles in Ordnung“ und der projizierte Detailtext als ein Link zu `moreRoute`; `heading`, Zähler und `moreLabel` erscheinen nicht, die Region heißt nach „Alles in Ordnung“ plus Detail. Die eigenen Texte stehen unter `ui.statusHero.*`.
- **Status-Eintrag:** `ui-status-entry` ist ein `surface-container-lowest`-Pod mit Icon-Container in `kindTone` (`UiStatusEntryTone`: ein Container, `surface` oder das kräftige `error` für Kritisches), `title`, `subtitle` (eine Zeile, abgeschnitten), rechts `value` in der kräftigen Farbe der Familie oder `severityLabel` („Kritisch“, ersetzt den Chevron). Mit `route` (Pfad oder `UrlTree` für Query-Parameter) ein Link, sonst statisch; projizierter Inhalt steht am Ende (Schalter in den Zeilen des Sheets). Der Icon-Container ist dekorativ, der Eintrag heißt nach seinen Texten.
- **Geräte-Pod:** `ui-device-pod` (140 × 116 px) nimmt `kind` (`DeviceKind` vom Server), `icon`, `value` (ohne Einheit), `unit`, `label` („Monstera · 22,1 °C“) und `chip` (`{ text, tone }`, Container-Farbe). Farbe je Art nach Designkonzept 2.4; eine Lampe ist `primary`, solange `pressed` wahr ist, sonst `surface-container-highest`. Mit `route` ein Link; mit `pressed` (ohne `route`) ein Schalter mit `aria-pressed`, der `toggled` sendet und bei `pending` (`aria-busy`, gedimmtes Icon, pulsierender Ring) keinen weiteren Druck annimmt; ohne beides statischer Inhalt (Nebenwerte der Geräteseite). Der Name kommt aus dem Inhalt in Lesereihenfolge („trocken 24 % Monstera · 22,1 °C“); ein `aria-label` in anderer Reihenfolge verstieße gegen WCAG 2.5.3. Druck skaliert auf 0,98, bei `prefers-reduced-motion` bleiben nur Farb- und Opazitätswechsel.
- **Pod-Reihe:** `ui-pod-row` scrollt seitlich mit Snap, jeder Pod ist per Tab erreichbar und scrollt fokussiert ins Bild; ab Medium blättern zwei Pfeile (`ui.podRow.*`) um je eine Reihenbreite. `wrap` lässt die Pods umbrechen (Block „Geräte“, Medium).
- **Sortierliste:** `ui-reorder-list` (`@smart/ui/forms`, CDK Drag-Drop) rendert je Zeile Ziehgriff (48 px, `aria-label` aus `items[].label`) und das Template `<ng-template [uiReorderRow]="items" let-item>`. Ziehen oder Pfeil hoch/runter auf dem fokussierten Griff verschiebt die Zeile, `reordered` liefert die IDs in neuer Reihenfolge, `UiAnnouncer` sagt „{label} an Position {n} von {m}“ an; die Liste behält die Reihenfolge, bis `items` sich ändert.
- **Sheet:** `UiBottomSheet.open(component, data)` zeigt `component` auf Compact als Bottom Sheet, ab Medium als Dialog, und löst mit dem Ergebnis von `UiSheetRef.close(result)` auf, mit `undefined` bei Escape, Klick auf den Hintergrund, Navigation oder `close()` ohne Wert. Der Inhalt holt `data` über `inject(UI_SHEET_DATA)` und den Griff über `inject(UiSheetRef)`; `ui-sheet` gibt ihm den Rahmen (Ziehgriff nur im Sheet, `heading` benennt den Dialog, `description`, Aktionen über `[uiSheetActions]`). Träger ist ein natives `<dialog>` (`showModal()`: Fokusfalle, inerte Seite, Escape, Fokusrückgabe), kein Material-Sheet: dessen Fokusfalle liegt in CDKs `_a11y-module-chunk`, das esbuild wegen des Material-Buttons dem initialen Bundle zuordnet, und hätte dort rund 9 kB gekostet, egal wie lazy das Sheet selbst lädt. Der Host lädt per `import()`.
- **Ansagen:** `UiAnnouncer` hält eine eigene Live-Region am Ende des `body` (kein CDK `LiveAnnouncer`, derselbe Chunk-Grund); während ein Sheet offen ist, wandert sie in den Dialog, weil alles außerhalb eines modalen `<dialog>` inert ist.
- **Fortschrittsband:** `ui-progress-band` ist ein `meter` mit `label` (Name) und `valueText` (`aria-valuetext`, beide übersetzt vom Aufrufer). `band` `{ from, to, tone }` markiert einen Bereich in der Container-Farbe; liegt der Wert darin, nimmt die Füllung die kräftige Farbe des Bands, sonst `primary`. Bei `prefers-reduced-motion` gleitet nichts.

## Instanz-Theme

Das Instanz-Theme gehört dem Server. Vorrang (Spec 3.8): Wert des Servers, `config.json` (`provideTheme({ instance })`), Build-Standard. Der Browser hält nur eine Kopie des Server-Werts (für den Start ohne Netz); die App holt den Wert beim Start und übergibt ihn mit `ThemeService.adoptInstance(value)` (`null`: auf dem Server ist nichts gespeichert). `adoptInstance` benachrichtigt niemanden. Änderungen im Editor (`setInstance`, `resetInstance`) speichern die Kopie und rufen die Hörer aus `onInstanceChange(listener)` (`resetInstance` meldet `null`); die App schickt sie an den Server. Gleiches Muster wie `adoptPersonal` und `onPersonalChange`.

## Bundle-Größe

Das initiale Bundle der App lag mit Etappe 3d bei rund 498 kB. Seit Etappe 4a lädt der `ThemeService` die Theme-Engine (`@smart/theme` mit `@material/material-color-utilities`, rund 50 kB) erst nach dem ersten Rendern als eigenen Chunk (`loadThemeEngine()`, `ThemeService.ready`); bis dahin bleibt das Theme aus `theme-boot.js` und dem Default-CSS stehen. Nur die engine-freie Auflösung (`resolveAppearance` aus `@smart/theme/resolve`) ist statisch importiert; `@smart/theme` selbst darf im Startpfad nur per `import()` vorkommen. Mit dem Einstieg `@smart/ui/shell` (siehe oben) sank der Stand von rund 481,7 kB (Etappe 4c) auf rund 471,1 kB, weil lazy Seiten keine UI-Dateien mehr in den Startpfad ziehen. Die Grenze im Build (`angular.json`) liegt bei 480 kB (Fehler) und 400 kB (Warnung).

Nicht abgedeckt: Symbole aus `@angular/core`, die nur lazy Seiten nutzen, können trotzdem im Startpfad landen (gemessen: `resource()` rund 6,5 kB, `httpResource()` rund 31 kB). Der Grund ist allgemein: esbuild ordnet jede _Datei_ einem Chunk zu, nach den Einstiegen, die sie erreichen. Eine Datei, die der Startpfad erreicht (auch nur über ein Barrel wie `@angular/cdk/a11y`, das Materials Button importiert), landet mit allem, was irgendwo aus ihr genutzt wird, im initialen Bundle, auch wenn der Nutzer lazy lädt (gemessen mit Etappe 6b: CDKs Fokusfalle für Materials Dialog und Bottom Sheet, rund 9,5 kB; deshalb trägt `UiBottomSheet` ein natives `<dialog>`). Ein `import()` eines solchen Barrels macht es schlimmer, weil dann jeder Export als genutzt gilt (gemessen: +25 kB). Nach neuen Importen `pnpm build` ausführen und die Größe prüfen; `ng build frontend --stats-json` und ein Vergleich der `inputs` je Chunk zeigen, welche Datei gewachsen ist. Stand mit Etappe 6b (Task 7): rund 478,2 kB.

## Texte und Sprache

Einfache Komponenten bekommen ihre Texte übersetzt vom Aufrufer (Inputs wie `label`, `heading`, `description`). Zusammengesetzte Komponenten wie `ui-theme-editor` bringen eigene Texte mit: Schlüssel unter `ui.*` in `src/i18n/de.json` und `en.json`. Die App und Storybook mischen sie über `loadUiTranslation(language)` in ihre Wurzelübersetzung.

- Schlüssel, die erst zur Laufzeit gewählt werden (z. B. Optionen aus einer Liste), mit `marker('ui.…')` aus `@jsverse/transloco-keys-manager/marker` markieren.
- `pnpm i18n:check` (Teil von `pnpm lint`) meldet fehlende und ungenutzte Schlüssel; ESLint (`smart/no-literal-template-text`) verbietet Text im Template ohne Schlüssel.
- Unit-Tests übersetzen mit `provideUiTranslocoTesting(language)` aus `src/lib/testing/i18n-testing.ts`.
