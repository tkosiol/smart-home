# ADR-0001: Monorepo mit pnpm-Workspaces

- Status: angenommen
- Datum: 2026-10-11

## Kontext

Frontend und Backend teilen API-Verträge; ein Repo für alles ist gewünscht.

## Entscheidung

pnpm-Workspaces ohne Nx; Original-CLIs von Angular und Nest; gemeinsame Pakete unter `packages/`; Grenzen per ESLint.

## Konsequenzen

Kein Build-Cache/keine Generatoren von Nx; Angular-Updates direkt über `ng update`; Modulgrenzen müssen selbst gepflegt werden (`tools/lint-config`).

Details: Spec, Abschnitt 5.1.
