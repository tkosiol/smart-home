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

| Zweck                                            | Befehl                                                                          |
| ------------------------------------------------ | ------------------------------------------------------------------------------- |
| Alles prüfen                                     | `pnpm lint && pnpm typecheck && pnpm test && pnpm test:tz && pnpm build`        |
| Übersetzungsschlüssel prüfen (auch in pnpm lint) | `pnpm i18n:check`                                                               |
| Workspace-Pakete (Contracts, Theme) neu bauen    | `pnpm packages:build` (oder `pnpm --filter @smart/contracts dev`)               |
| Lokale Infrastruktur                             | `pnpm infra:up`, `pnpm infra:test`, `pnpm infra:down`                           |
| Backend / Frontend                               | `pnpm --filter @smart/backend start:dev`, `pnpm --filter @smart/frontend start` |
| Backend-Integrationstests (Docker nötig)         | `pnpm --filter @smart/backend test`                                             |
| Produktions-Stack lokal testen                   | `sh infra/compose/test/stack-test.sh`                                           |
| Deploy-Skripte testen                            | `bash infra/deploy/test/run-tests.sh`                                           |
| Symbol-Schrift neu erzeugen                      | `pnpm icons:build`                                                              |
| App-Icon (PNGs, Favicon) neu erzeugen            | `pnpm app-icon:build`                                                           |

`pnpm install` baut `@smart/contracts` und `@smart/theme` nur bei einer echten Installation (pnpm überspringt Lifecycle-Skripte, wenn `node_modules` aktuell ist). Nach Änderungen an den Contracts oder Theme-Paketen daher `pnpm packages:build` (baut `@smart/contracts` und `@smart/theme` in Abhängigkeitsreihenfolge).

Lokale Ports (nur 127.0.0.1): DB 5433, MQTT 1884, Mailpit SMTP 1026 / UI 8026.

Laufzeitkonfiguration der Web-App: `SMART_INSTANCE_APPEARANCE_EDITOR`, `SMART_INSTANCE_APPEARANCE` → `/config.json` (siehe `docs/runbooks/provisioning.md`).

## Architekturregeln (per Lint erzwungen)

- Backend: `platform/` → nichts Fachliches; `core/*` → nie `modules/*`; Module nie untereinander; fremde Elemente nur über deren `index.ts`.
- Frontend: Features nie untereinander; `core/` und `shell/` nie auf Features; fremde Elemente nur über `index.ts`.
- Frontend-Features registrieren sich über `provideFeature()` (Menüeinträge, Übersichtskarten). Seitentexte sind ein Transloco-Feature-Scope (`scopePathMap` in `apps/frontend/transloco.config.cjs`). Mit `marker()` markierte Schlüssel stehen in der Wurzelübersetzung (`app.*`).
- Frontend-UI: kein `@angular/material`/`@angular/cdk` außerhalb von `@smart/ui`; keine Komponenten-Styles außerhalb von `@smart/ui`; in `@smart/ui` nur Design-Tokens (keine Hex-Farben, keine px-Abstände außerhalb `tokens/`); keine `DatePipe`; kein sichtbarer Text ohne Übersetzungsschlüssel (ESLint `smart/no-literal-template-text`, `pnpm i18n:check`). Formularelemente und `UiThemeEditor` kommen aus `@smart/ui/forms`, alles andere aus `@smart/ui` (Details: `apps/frontend/projects/ui/README.md`); `core/`, `shell/` und die App-Wurzel dürfen `@smart/ui/forms` nicht importieren (initiales Bundle).
- Initiales Bundle der App: Grenze 500 kB (Build-Fehler), Stand Etappe 3d: rund 498 kB. Neuer Code, der beim Start lädt, braucht vorher Platz (lazy laden).
- Zeit: speichern/übertragen nur UTC (`…Z`), Anzeige in Haushalts-Zeitzone, reine Datumswerte als `YYYY-MM-DD`-String. Tests laufen zusätzlich mit `TZ=Pacific/Chatham`.

Regeln nie abschalten, um einen Fund loszuwerden. Passt eine Regel nicht, wird die Regel (mit Test) in `tools/lint-config` angepasst.
