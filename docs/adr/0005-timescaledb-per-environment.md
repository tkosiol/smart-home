# ADR-0005: TimescaleDB in eigenen Containern pro Umgebung

- Status: angenommen
- Datum: 2026-10-11

## Kontext

Zeitreihen brauchen Kompression, Retention und Aggregate; auf dem VPS läuft bereits ein gemeinsamer Postgres.

## Entscheidung

Eigene TimescaleDB-Container pro Umgebung statt des bestehenden Postgres.

## Konsequenzen

Etwas mehr RAM; dafür Isolation, eigene Extension, unabhängige Upgrades und Backups.

Details: Spec, Abschnitt 3.2.
