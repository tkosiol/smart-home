# Etappe 3: Design-System und App-Rahmen – Spec

|                     |                                                                         |
| ------------------- | ----------------------------------------------------------------------- |
| Status              | Entwurf zur Freigabe                                                    |
| Datum               | 2026-10-11                                                              |
| Bezug               | Architektur-Spec Abschnitt 10, Self-Hosting-Nachtrag (ADR-0018)         |
| Visuelle Referenzen | Theme-Werkstatt und App-Icon-Entwürfe (Artefakte, nicht Teil des Repos) |

## 1. Ziel

Nach Etappe 3 ist die PWA als App-Rahmen installierbar und vollständig gestaltet. Alle späteren Oberflächen entstehen ausschließlich aus `@smart/ui`; das Theme ist auf Instanz- und Nutzerebene einstellbar wie im Material Theme Builder. Echte Gerätedaten folgen ab Etappe 6, Login ab Etappe 4.

**Hauptnutzung:** Handy. Navigation und Dichte sind dafür optimiert; Tablet und Desktop bekommen adaptive Varianten derselben Struktur.

## 2. Sichtbares Ergebnis

- Installierbare App mit Rahmen: Navigationsleiste unten (**Übersicht, Räume, Geräte, Mehr**), oben App-Leiste mit Haushaltsname und **Glocke** für Benachrichtigungen (Zähler, in dieser Etappe immer 0).
- **Übersicht, Räume, Geräte:** gestaltete Leer-Zustände mit kurzer Erklärung, was dort erscheinen wird.
- **Mehr:** Liste der Bereiche (Module, Benachrichtigungen, Haushalt, Gateways, Einstellungen). Noch nicht vorhandene Bereiche sind als „kommt bald“ gekennzeichnet und nicht anklickbar.
- **Einstellungen → Darstellung** (jeder): Theme-Editor für das persönliche Theme und Sprachwahl, live wirksam, „Auf Standard zurücksetzen“.
- **Einstellungen → Erscheinungsbild der Installation:** Theme-Editor für den Instanz-Standard inklusive Formen und Schrift. Bis zur Admin-Rolle (Etappe 4) nur sichtbar, wenn die Laufzeitkonfiguration `features.instanceAppearanceEditor` aktiv ist (lokal und Staging an, Produktion aus).
- Speicherung in dieser Etappe im Browser (`localStorage`, mit `try/catch`, App funktioniert ohne). Ab Etappe 4: persönliches Theme am User, Instanz-Theme in den Instanz-Einstellungen.

## 3. Navigation und Routen

| Fensterbreite (M3)  | Navigation                            |
| ------------------- | ------------------------------------- |
| Compact (< 600 px)  | Navigation Bar unten, 4 Ziele         |
| Medium (600–839 px) | Navigation Rail links                 |
| Expanded (≥ 840 px) | Navigation Drawer, dauerhaft sichtbar |

Routen (lazy geladene Features): `/` Übersicht, `/raeume`, `/geraete`, `/mehr`, `/mehr/einstellungen` (Übersicht der Einstellungen), `/mehr/einstellungen/darstellung`, `/mehr/einstellungen/installation`. Unbekannte Routen zeigen eine Seite „Nicht gefunden“ mit Weg zur Übersicht.

Erweiterbarkeit (Spec 10.7): Feature-Module registrieren Einträge für „Mehr“ und Karten für die Übersicht über `provideFeature()`, nicht über die Navigationsleiste. Die Leiste bleibt bei vier Zielen.

## 4. Theme

### 4.1 Standard (Instanz-Default)

| Feld                      | Wert                                                                                           |
| ------------------------- | ---------------------------------------------------------------------------------------------- |
| Grundfarbe                | Petrol `#00687a`                                                                               |
| Variante                  | Tonal Spot                                                                                     |
| Kernfarben-Overrides      | keine                                                                                          |
| Farbtreue                 | aus                                                                                            |
| Formen                    | Standard (M3: klein 8 px, mittel 12 px, groß 16 px, voll rund)                                 |
| Schrift                   | Roboto Flex                                                                                    |
| Modus (Nutzer-Default)    | System                                                                                         |
| Kontrast (Nutzer-Default) | Standard; bei `prefers-contrast: more` automatisch Hoch, solange der Nutzer nichts gewählt hat |

### 4.2 Ebenen

| Ebene                                    | Einstellbar                                                  | Wirkung                                              |
| ---------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------- |
| Instanz (Hoster, später Plattform-Admin) | Grundfarbe, Kernfarben, Farbtreue, Variante, Formen, Schrift | Standard für alle Nutzer der Installation            |
| Persönlich (jeder Nutzer)                | Grundfarbe, Kernfarben, Farbtreue, Variante, Modus, Kontrast | überschreibt die Farbfelder der Instanz nur für sich |

Zusammenführung: Formen und Schrift kommen immer von der Instanz. Für die Farbfelder gilt: Hat der Nutzer eine eigene Farbkonfiguration gespeichert, gilt sie vollständig (Grundfarbe, Overrides, Farbtreue, Variante als Einheit), sonst die der Instanz. Modus und Kontrast sind rein persönlich.

### 4.3 Datenmodell

`@smart/contracts` erhält Zod-Schemas:

- `themeColorsSchema`: `seed` (Hex), `variant` (`tonalSpot` | `neutral` | `vibrant` | `expressive` | `fidelity` | `content` | `monochrome`), `colorMatch` (boolean), `coreOverrides` (optionale Hex-Werte für `primary`, `secondary`, `tertiary`, `error`, `neutral`, `neutralVariant`)
- `instanceAppearanceSchema`: `colors` + `shape` (`kantig` | `standard` | `weich`) + `font` (`roboto-flex` | `figtree` | `atkinson`)
- `personalAppearanceSchema`: optionale `colors` + `mode` (`system` | `light` | `dark`) + `contrast` (`system` | `standard` | `medium` | `high`; `system` = Standard, bei `prefers-contrast: more` Hoch)

### 4.4 Berechnung (Verhalten wie Material Theme Builder)

- Bibliothek `@material/material-color-utilities` (Version zum Etappenstart gepinnt).
- Ohne Overrides: Schema der gewählten Variante aus der Grundfarbe.
- **Kernfarben:** Nicht überschriebene Kernfarben werden aus der Quelle abgeleitet und im Editor als „abgeleitet“ mit ihrem Wert angezeigt; sie ändern sich mit der Grundfarbe. Ein Override von Primär wird zur Quelle, alle nicht überschriebenen Farben leiten sich daraus neu ab. Ein Override startet im Editor beim aktuell abgeleiteten Wert.
- **Farbtreue an:** Overrides behalten ihre eigene Buntheit (Palette direkt aus der Farbe), Rollen-Töne nach Fidelity-Logik. **Farbtreue aus:** Overrides liefern nur den Farbton, die Buntheit kommt aus der Variante.
- **Statusfarben** `dry` (Bernstein), `ok` (Grün), `wet` (Blau): an die Quelle harmonisiert (höchstens 8°); `warning` nutzt die Fehlerrollen des Schemas (Rot, Orange und Bernstein wären in den nötigen dunklen Tönen nicht unterscheidbar – Warnung und Fehler unterscheiden Symbol und Text); `offline`: neutrales Grau. Je Rolle `color`, `on-color`, `container`, `on-container`, für Hell/Dunkel und alle Kontraststufen.
- Ausgabe: CSS-Variablen `--mat-sys-*` (Material-Rollen) und `--smart-*` (Status, Formen, Schrift) auf `:root`, gesetzt per CSSOM (kompatibel mit der strikten CSP).

### 4.5 Ablauf im Browser

1. **Build:** Ein Skript erzeugt aus dem Instanz-Default eine CSS-Datei mit allen Rollen für Hell und Dunkel (über `prefers-color-scheme`) – korrekte Farben vor dem ersten Skript.
2. **Start:** Das externe Skript `theme-boot.js` (kein Inline-Skript wegen CSP) setzt die zuletzt berechneten Variablen des Nutzers aus dem Zwischenspeicher, für Hell und Dunkel getrennt gespeichert, damit „System“ ohne Aufblitzen funktioniert.
3. **Laufzeit:** `ThemeService` berechnet bei jeder Änderung neu, reagiert auf Wechsel von `prefers-color-scheme` und `prefers-contrast` und aktualisiert den Zwischenspeicher.
4. **Laufzeitkonfiguration (Self-Hosting):** Der Instanz-Default kann ohne Neubau über `config.json` (vom `web`-Container ausgeliefert, aus den Umgebungsvariablen `SMART_INSTANCE_APPEARANCE_EDITOR` und `SMART_INSTANCE_APPEARANCE` erzeugt) überschrieben werden. Vorrang: im Browser gespeicherte Instanz (nur solange `features.instanceAppearanceEditor` aktiv ist) vor `config.json` vor Build-Default.

## 5. Komponenten (`@smart/ui`)

| Gruppe      | Komponenten                                                                                                     |
| ----------- | --------------------------------------------------------------------------------------------------------------- |
| Layout      | `ui-page`, `ui-stack`, `ui-grid`, `ui-section`                                                                  |
| Rahmen      | `ui-adaptive-shell`, `ui-top-app-bar`, `ui-badge`                                                               |
| Bedienung   | `ui-button`, `ui-icon-button`, `ui-switch`, `ui-segmented-button`, `ui-select`, `ui-chip-set`, `ui-color-field` |
| Inhalt      | `ui-card`, `ui-list`, `ui-list-item`, `ui-empty-state`, `ui-skeleton`, `ui-icon`                                |
| Formular    | `ui-text-field`                                                                                                 |
| Theme       | `ui-theme-editor` (Modi: `personal` / `instance`)                                                               |
| Rückmeldung | `ui-snackbar` (Service), `ui-banner`                                                                            |
| Pipes       | `uiDateTime`, `uiRelativeTime` (Haushalts-Zeitzone, `Intl.DateTimeFormat`)                                      |

`ui-select` kam mit Plan 3c dazu: Auswahlen mit vier und mehr oder langen Optionen passen auf dem schmalsten Handy nicht in einen Segmented Button.

Regeln aus Spec 10.3 gelten unverändert und werden erstmals an echtem Code durchgesetzt. Nicht in Etappe 3: `ui-chart`, Dialoge, Gerätekacheln.

## 6. Schriften und Icons

- Roboto Flex, Figtree, Atkinson Hyperlegible Next und Material Symbols (Rounded, variabel) selbst gehostet im `web`-Image; geladen wird nur die aktive Schrift.
- **App-Icon:** Entwurf B „Vernetztes Dach“ (Anhang A). Erzeugt werden: maskierbares PWA-Icon (Sicherheitszone eingehalten), Apple-Touch-Icon, Favicon (SVG + 32 px PNG). Das Icon ist instanzunabhängig.

## 7. Sprache

Transloco, Deutsch und Englisch, Übersetzungsdateien pro Feature (lazy). Startsprache aus der Browsersprache, Rückfall Deutsch; Wahl unter „Darstellung“, gespeichert wie das Theme. Fehlende und ungenutzte Schlüssel lassen die CI fehlschlagen. Kein sichtbarer Text ohne Übersetzungsschlüssel.

## 8. PWA

Web-App-Manifest (Name „Smart Home“, Theme-Farbe aus dem Instanz-Default, Icons aus Abschnitt 6), Angular Service Worker für den App-Rahmen, Banner „Offline – Anzeigen können veraltet sein“ und „Neue Version verfügbar – neu laden“. Keine Datensynchronisierung, kein Push (Etappe 7).

## 9. Storybook

Stories für jede Komponente mit allen Varianten; Werkzeugleiste für Grundfarbe, Variante, Modus, Kontrast, Formen, Schrift und Sprache über denselben `ThemeService`. axe-Prüfung in jeder Story, Interaktionstests in der CI. Veröffentlichung bei jedem Merge auf `main` über GitHub Pages (`tkosiol.github.io/smart-home`), eigener Workflow mit minimalen Rechten.

## 10. Qualität und Tests

- `ThemeService`: Unit-Tests für Mindestkontraste von Text/Hintergrund-Paaren über alle Varianten und Kontraststufen, Ableitung und Übernahme von Kernfarben, Farbtreue, Unterscheidbarkeit der Statusfarben, Zusammenführung von Instanz und persönlicher Konfiguration.
- Komponenten: Storybook-Interaktionstests + axe (WCAG 2.2 AA).
- Playwright-Smoke (gegen den Stack): Navigation auf Handy- und Desktopbreite, Theme bleibt nach Neuladen erhalten, Sprachwechsel, Manifest und Service Worker vorhanden, keine CSP-Verstöße, kein Aufblitzen beim Laden eines gespeicherten dunklen Themes.
- Bundle-Budget: initiales JavaScript unter 500 KB (unkomprimiert).

## 11. Nicht-Ziele

Login, Rollen und serverseitige Speicherung (Etappe 4); Diagramme und Gerätedaten (Etappe 6); Push (Etappe 7); Icon pro Instanz; Theme pro Haushalt; Farben aus Bildern.

## Anhang A: App-Icon B „Vernetztes Dach“ (SVG, viewBox 108)

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108">
  <rect width="108" height="108" fill="#d8f6ff"/>
  <path d="M32 56 54 36l22 20" fill="none" stroke="#004e5c" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M37 56v18h34V56" fill="none" stroke="#004e5c" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
  <line x1="54" y1="36" x2="54" y2="62" stroke="#565d7e" stroke-width="3" stroke-linecap="round"/>
  <circle cx="54" cy="36" r="7" fill="#00687a"/>
  <circle cx="32" cy="56" r="6" fill="#00687a"/>
  <circle cx="76" cy="56" r="6" fill="#00687a"/>
  <circle cx="54" cy="64" r="5" fill="#565d7e"/>
</svg>
```
