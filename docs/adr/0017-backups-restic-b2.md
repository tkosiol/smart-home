# ADR-0017: Backups mit restic nach Backblaze B2 (EU)

- Status: angenommen
- Datum: 2026-10-11

## Kontext

Datenbank und Gateway-Daten brauchen eine Kopie außerhalb des VPS.

## Entscheidung

restic (verschlüsselt) nach Backblaze B2 (EU), ausgeführt von einem `backup`-Container im Produktions-Stack (supercronic): nächtlich DB-Dump und Stack-Konfiguration, Aufbewahrung 7/4/6, monatlicher Restore-Test in eine Wegwerf-Datenbank.

## Konsequenzen

Monatliche Kosten nahe null; Backup-Ausfälle melden sich über healthchecks.io.

Details: Spec, Abschnitt 11.3.
