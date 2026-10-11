# ADR-0012: Laufzeit-Theming mit material-color-utilities

- Status: angenommen
- Datum: 2026-10-11

## Kontext

Themes sollen wie im Material Theme Builder funktionieren.

## Entscheidung

Laufzeit-Theming mit `@material/material-color-utilities`: Grundfarbe, Variante, Modus, Kontrast; harmonisierte Statusfarben.

## Konsequenzen

Komponenten dürfen nur Farbrollen nutzen; Standard-Theme wird zusätzlich beim Build erzeugt (kein Aufblitzen).

Details: Spec, Abschnitt 10.5.
