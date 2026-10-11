# ADR-0014: UTC überall, Anzeige in Haushalts-Zeitzone

- Status: angenommen
- Datum: 2026-10-11

## Kontext

Sommer-/Winterzeit und verschiedene Zeitzonen führen leicht zu Fehlern.

## Entscheidung

UTC in DB und API (`…Z`), Anzeige in der Haushalts-Zeitzone, Tageswerte zeitzonenbewusst, reine Daten als String.

## Konsequenzen

Zod lehnt Zeitstempel ohne `Z` ab; Tests laufen zusätzlich mit exotischer Zeitzone.

Details: Spec, Abschnitt 9.
