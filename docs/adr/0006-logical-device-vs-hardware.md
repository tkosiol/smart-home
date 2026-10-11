# ADR-0006: Logisches Gerät getrennt von Hardware

- Status: angenommen
- Datum: 2026-10-11

## Kontext

Sensoren werden getauscht oder neu gekoppelt; der Verlauf soll erhalten bleiben.

## Entscheidung

Messwerte hängen am logischen Gerät; Hardware wird über Bindungen mit Historie zugeordnet.

## Konsequenzen

Neue Hardware ist zunächst „nicht zugeordnet“; Zuordnung ist ein expliziter Schritt in der App.

Details: Spec, Abschnitt 8.4.
