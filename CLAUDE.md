# CLAUDE.md

Smart-Home-Plattform. Verbindliche Architektur: `docs/superpowers/specs/2026-10-11-smart-home-architecture-design.md`. Entscheidungen: `docs/adr/`. Umsetzungspläne: `docs/superpowers/plans/`.

## Arbeitsweise

- Erst Spec, dann Plan, dann TDD. Keine Implementierung ohne freigegebenen Plan.
- Jede Änderung über Branch → PR → grüne CI. `main` ist geschützt.
- Privater Kontext (Hosts, Zugänge, Secret-Inventar): `CLAUDE.local.md` und `.local/` – beide gitignored.
- Deploy, Provisionierung, Backups und Monitoring: `docs/runbooks/`. Secrets für Umgebungen entstehen nur über `infra/deploy/provision.sh`, das Till selbst ausführt – Claude fragt nie nach Secret-Werten.

## Konventionen

- Code, Bezeichner, Kommentare, Commit-Messages: Englisch. Doku in `docs/`: Deutsch.
- Conventional Commits mit Scope aus: repo, frontend, backend, contracts, ui, lint, infra, gateway, ci, docs, deps.
- **Keine KI-Attribution** in Commits oder PRs (kein `Co-Authored-By: Claude`, kein „Generated with …“). commitlint blockiert das.
- **Öffentliches Repo:** keine IPs, privaten Hostnamen, E-Mail-Adressen oder Secrets in versionierten Dateien. gitleaks blockiert bekannte Secret-Muster.
- TypeScript ist auf **6.0.x** gepinnt (Angular 22). Nicht auf 7 aktualisieren, bevor Angular es unterstützt.
- pnpm 12: Build-Skripte von Abhängigkeiten nur nach Prüfung freigeben (`pnpm approve-builds <paket>` → `allowBuilds` in `pnpm-workspace.yaml`).

## Befehle

| Zweck                                    | Befehl                                                                          |
| ---------------------------------------- | ------------------------------------------------------------------------------- |
| Alles prüfen                             | `pnpm lint && pnpm typecheck && pnpm test && pnpm test:tz && pnpm build`        |
| Contracts nach Änderung neu bauen        | `pnpm contracts:build` (oder `pnpm --filter @smart/contracts dev`)              |
| Lokale Infrastruktur                     | `pnpm infra:up`, `pnpm infra:test`, `pnpm infra:down`                           |
| Backend / Frontend                       | `pnpm --filter @smart/backend start:dev`, `pnpm --filter @smart/frontend start` |
| Backend-Integrationstests (Docker nötig) | `pnpm --filter @smart/backend test`                                             |
| Produktions-Stack lokal testen           | `sh infra/compose/test/stack-test.sh`                                           |
| Deploy-Skripte testen                    | `bash infra/deploy/test/run-tests.sh`                                           |

`pnpm install` baut `@smart/contracts` nur bei einer echten Installation (pnpm überspringt Lifecycle-Skripte, wenn `node_modules` aktuell ist). Nach Änderungen an den Contracts daher `pnpm contracts:build`.

Lokale Ports (nur 127.0.0.1): DB 5433, MQTT 1884, Mailpit SMTP 1026 / UI 8026.

## Architekturregeln (per Lint erzwungen)

- Backend: `platform/` → nichts Fachliches; `core/*` → nie `modules/*`; Module nie untereinander; fremde Elemente nur über deren `index.ts`.
- Frontend: Features nie untereinander; `core/` und `shell/` nie auf Features; fremde Elemente nur über `index.ts`.
- Frontend-UI: kein `@angular/material`/`@angular/cdk` außerhalb von `@smart/ui`; keine Komponenten-Styles außerhalb von `@smart/ui`; in `@smart/ui` nur Design-Tokens (keine Hex-Farben, keine px-Abstände außerhalb `tokens/`); keine `DatePipe`.
- Zeit: speichern/übertragen nur UTC (`…Z`), Anzeige in Haushalts-Zeitzone, reine Datumswerte als `YYYY-MM-DD`-String. Tests laufen zusätzlich mit `TZ=Pacific/Chatham`.

Regeln nie abschalten, um einen Fund loszuwerden. Passt eine Regel nicht, wird die Regel (mit Test) in `tools/lint-config` angepasst.
