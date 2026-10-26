# Startbundle ohne Material – Design

- Status: freigegeben (Till, 2026-10-27, im Chat)
- Bezug: ADR-0011 (mit Nachtrag), Issues #68 und #101, Designkonzept Abschnitt „Bewegung“

## 1. Ziel

Das initiale Bundle der App sinkt deutlich, damit Etappe 6c (Verläufe, Diagramme, SSE) Platz hat. Optisch und bei der Barrierefreiheit gibt es keinen Rückschritt.

- **Erfolg:** initial unter **400 kB** (vorher 482,5 kB); danach sinkt die Fehlergrenze auf den neuen Stand plus rund 15 kB, die Warnung liegt bei 400 kB.
- **Umfang:** nur was beim Start lädt. Lazy Material-Bausteine (Select, Form-Field, Chips, Drag & Drop, Snackbar) bleiben unverändert.

## 2. Ausgangslage (Messung 2026-10-27)

Aufschlüsselung des Startcodes nach Paketen (esbuild-Metafile, Anteile vor der Minifizierung):

| Block                                             | Anteil | Bemerkung                                  |
| ------------------------------------------------- | ------ | ------------------------------------------ |
| Angular (core, router, common, platform-browser)  | ~60 %  | Framework                                  |
| Material + CDK                                    | ~70 kB | fast nur über `ui-button`/`ui-icon-button` |
| zod                                               | ~34 kB | Kern von `zod/mini`, siehe Abschnitt 5     |
| rxjs, Transloco                                   | ~45 kB | vom Router und von Transloco gebraucht     |
| eigener Code (`core`, `shell`, `@smart/ui/shell`) | ~45 kB |                                            |

Material kommt in den Startcode über `MatButton`/`MatIconButton` (mit Ripple, FocusMonitor, KeyManager und dem CSS des Buttons) und über den `BreakpointObserver` aus `@angular/cdk/layout` in `ui-adaptive-shell`.

## 3. Eigene Buttons

`ui-button` und `ui-icon-button` behalten ihre öffentliche API (Inputs, Output `pressed`, Link-Modus mit `route`, `fullWidth`, projizierter Inhalt). Darunter liegt ein natives `<button>` bzw. `<a>` ohne Material.

- **Maße nach M3:** Button 40 px hoch (neues Token `--smart-size-button`), Form `--smart-shape-control`, Schrift `label-large`, Innenabstand `xl` (mit Symbol vorne `lg`, Variante `text` `md`), Symbol `sm` mit Abstand `sm`. Icon-Button 40 px (neues Token `--smart-size-icon-button`), Variante `tonal` 48 px auf `surface-container-high`.
- **Touch-Ziel:** mindestens `--smart-size-touch` über ein unsichtbares Pseudo-Element, ohne die Layoutgröße zu ändern.
- **Varianten (Farbrollen):** `filled` primary/on-primary; `tonal` secondary-container/on-secondary-container; `outlined` Rand outline, Text primary; `text` primary; `elevated` surface-container-low, Text primary, Schatten level1 (Hover level2). Icon-Button `standard` on-surface-variant ohne Fläche.
- **Zustände:** State Layer (Pseudo-Element in `currentColor`) mit `--smart-opacity-hover` bei Hover, `--smart-opacity-pressed` bei Fokus und Druck. Beim Drücken ziehen sich die Ecken auf `corner-medium` zusammen (M3 Expressive, `--smart-motion-duration-short`); bei `prefers-reduced-motion` ohne Übergang. Kein Ripple – dieselbe Drucksprache wie die Geräte-Pods.
- **Deaktiviert:** Fläche on-surface 12 %, Inhalt on-surface 38 %, kein Schatten, kein State Layer.
- **Fokus:** `:focus-visible` mit Rahmen `--smart-focus-width` in der Farbe `--ui-focus-color` (Standard primary), Abstand neues Token `--smart-focus-offset`.
- **Forced Colors:** sichtbarer Rand in `ButtonText` bzw. `LinkText`, deaktiviert `GrayText`.
- **Anpassung durch umgebende Bausteine** nur über Custom Properties der Buttons: `--ui-button-text-color` (Variante `text`), `--ui-icon-button-color`, `--ui-focus-color`, `--ui-icon-button-size`. Banner (Text in `currentColor`), Snackbar (inverse Farben) und Reorder-Handle (48 px) nutzen sie statt der Material-Overrides.
- Der Aktions-Button der Snackbar wird ein `ui-button variant="text"`; danach importiert `@smart/ui` nichts mehr aus `@angular/material/button`.

## 4. Breakpoints ohne CDK

Eine kleine Hilfsfunktion `mediaQuerySignal(query)` in `lib/theme/media-queries.ts` liefert ein Signal auf Basis von `MEDIA_QUERIES` (Abmelden über `DestroyRef`). `ui-adaptive-shell` und `ui-pod-row` nutzen sie, `UiBottomSheet` fragt `MEDIA_QUERIES.matches(MEDIUM)`. Tests und Stories setzen ein gemeinsames `FakeMediaQueries` ein. `@angular/cdk/layout` wird in `@smart/ui` nicht mehr gebraucht.

## 5. zod beim Start (Spike-Ergebnis)

Geplant war, die Schemas des Startcodes auf `zod/mini` umzustellen. Der Spike zeigt: `@smart/contracts` nutzt bereits durchgehend `zod/mini`. Die rund 34 kB sind der Kern von zod (`v4/core`), der bleibt, sobald der Startcode überhaupt ein Schema prüft (`meSchema`, `apiErrorSchema`, Preferences, Runtime-Config, Appearance-Caches).

**Entscheidung:** zod bleibt vorerst im Startcode. Die Prüfung schützt vor veralteten lokalen Caches und einer fehlerhaften `config.json`; der Gewinn wäre rund 10 kB komprimiert. Wird es wieder eng, ist „Startcode prüft ohne zod, lazy Seiten mit zod“ der nächste Hebel (Issue).

## 6. Lazy Routen (#101)

`features/devices`, `gateways` und `households` exportieren ihre Routen wie `/hinweise` über einen zweiten lazy Schritt, so dass `index.ts` beim Start nur die Feature-Registrierung lädt.

## 7. Absicherung

- **Lint:** Dateien, die `@smart/ui/shell` einbindet, dürfen nichts aus `@angular/material` oder `@angular/cdk` importieren (Regel mit Test in `tools/lint-config`).
- **Budget:** Fehlergrenze auf den gemessenen Stand plus rund 15 kB; `CLAUDE.md` nennt den neuen Stand.
- **ADR-0011, Nachtrag:** Sichtbare, einfache Bausteine baut `@smart/ui` selbst auf nativen Elementen; Material bleibt für Bausteine mit komplexem Verhalten (Auswahllisten, Chips, Drag & Drop, Overlays). Für deren späteren Ersatz ist Angular Aria (kopflose, barrierefreie Bausteine) der Kandidat.

## 8. Tests

- Bestehende Specs und Stories von `ui-button`/`ui-icon-button` laufen weiter; Story-Prüfungen, die Material-Klassen abfragen (`.mat-mdc-button-touch-target`, `.mat-mdc-snackbar-surface`), prüfen stattdessen das eigene Touch-Ziel bzw. die eigene Fläche.
- Neu: Varianten hell und dunkel mit axe; Touch-Ziel ≥ 48 px; deaktiviert nicht fokussierbar und ohne `pressed`; Link-Modus ohne `pressed`; Tastatur (Enter/Leertaste) über das native Element.
- `mediaQuerySignal`: Startwert und Wechsel.
- Bundle-Messung nach jedem Schritt.

## 9. Ergebnis (2026-10-27)

- Initial **411,7 kB** (vorher 482,5 kB, −70,8 kB); komprimiert 113,5 kB (vorher 128,4 kB). Material und CDK sind vollständig aus dem Startcode verschwunden.
- Das Ziel „unter 400 kB“ ist ohne den zod-Hebel (Abschnitt 5) nicht erreicht. Fehlergrenze daher **425 kB**, Warnung bleibt bei 400 kB als Zielmarke; Folge-Issue #120.
