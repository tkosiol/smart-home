# ADR-0013: i18n mit Transloco (DE/EN)

- Status: angenommen
- Datum: 2026-10-11

## Kontext

Deutsch und Englisch von Anfang an, umschaltbar zur Laufzeit.

## Entscheidung

Transloco mit Übersetzungsdateien pro Feature; API liefert Fehlercodes statt Texten.

## Konsequenzen

Kein Angular-eigenes i18n; CI prüft fehlende Schlüssel.

Details: Spec, Abschnitt 10.9.
