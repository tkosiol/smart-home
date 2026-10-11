# ADR-0009: Benutzer, Haushalte, Rollen, Einladungen

- Status: angenommen
- Datum: 2026-10-11

## Kontext

Erst ein Nutzer, später ein Haushalt mit mehreren Personen.

## Entscheidung

User ↔ Household über Memberships mit Rollen `owner`/`member`/`viewer`; Registrierung nur per Einladung; Plattform-Admin separat.

## Konsequenzen

Mandantentrennung muss in jedem Endpunkt geprüft und getestet werden.

Details: Spec, Abschnitt 7.1, 7.4.
