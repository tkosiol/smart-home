# ADR-0011: Angular Material gekapselt in `@smart/ui`

- Status: angenommen
- Datum: 2026-10-11

## Kontext

Die UI soll ausschließlich aus Shared Components bestehen und M3 folgen.

## Entscheidung

Angular Material ist internes Detail von `@smart/ui`; Features ohne eigenes CSS; nur Design-Tokens; alles per Lint erzwungen.

## Konsequenzen

Fehlende UI erfordert eine neue `ui-*`-Komponente; einheitliches Erscheinungsbild ist technisch gesichert.

Details: Spec, Abschnitt 10.2, 10.3.

## Nachtrag 2026-10-27: sichtbare Bausteine ohne Material

Material im Startcode kostete rund 70 kB des initialen Bundles, fast nur über Materials Button (mit Ripple, FocusMonitor und KeyManager). Das M3-Aussehen kommt ohnehin aus Farbrollen und Tokens (ADR-0012), nicht aus dem Material-Code.

- **Entscheidung:** Einfache, sichtbare Bausteine baut `@smart/ui` selbst auf nativen Elementen (`ui-button`, `ui-icon-button`; Breakpoints über `mediaQuerySignal()` statt CDK). Material bleibt für Bausteine mit komplexem Verhalten (Auswahllisten, Chips, Drag & Drop, Overlays, Snackbar), die nur lazy Seiten laden.
- **Erzwungen:** Dateien, die `@smart/ui/shell` exportiert, dürfen Material und CDK nicht statisch importieren (ESLint, `tools/lint-config`); `import()` bleibt erlaubt.
- **Anpassung zwischen Bausteinen:** über `--ui-*`-Custom-Properties (Stylelint lässt nur diese in Komponenten-Styles zu), z. B. färbt `ui-banner` seine Text-Buttons über `--ui-button-text-color`.
- **Später:** Für den Ersatz der komplexen Material-Bausteine ist Angular Aria (kopflose, barrierefreie Bausteine des Angular-Teams) der Kandidat; vor einem Wechsel den Reifegrad prüfen.

Details: `docs/superpowers/specs/2026-10-27-bundle-ohne-material-design.md`.
