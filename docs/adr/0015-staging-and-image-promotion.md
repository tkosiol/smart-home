# ADR-0015: Staging + Produktion mit Image-Promotion

- Status: angenommen
- Datum: 2026-10-11

## Kontext

Änderungen sollen vor Produktion in einer realistischen Umgebung laufen.

## Entscheidung

Staging + Produktion; Images einmal bauen, nach Freigabe unverändert befördern.

## Konsequenzen

Zweiter Stack auf dem VPS; Staging nutzt nur den Simulator und kann keine echten Geräte schalten.

Details: Spec, Abschnitt 6.2.
