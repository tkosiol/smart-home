# smart-home

Selbst gehostete Smart-Home-Plattform: Angular-PWA, NestJS-Backend, TimescaleDB, Zigbee-Geräte über Zigbee2MQTT.

> Status: Fundament im Aufbau (Etappe 1). Architektur: [`docs/superpowers/specs/2026-10-11-smart-home-architecture-design.md`](docs/superpowers/specs/2026-10-11-smart-home-architecture-design.md)

## Struktur

| Pfad                 | Inhalt                                               |
| -------------------- | ---------------------------------------------------- |
| `apps/frontend`      | Angular-PWA (später inkl. Design-System `@smart/ui`) |
| `apps/backend`       | NestJS-API                                           |
| `packages/contracts` | Gemeinsame Zod-Schemas und Typen                     |
| `tools/lint-config`  | ESLint-/Stylelint-Regeln inkl. Architekturgrenzen    |
| `infra/local`        | Lokale Entwicklungsinfrastruktur                     |
| `docs/`              | Architektur, ADRs, Specs und Pläne                   |

## Voraussetzungen

Node 24.21.0 (`.nvmrc`), pnpm 12.11.2, Docker, gitleaks.

## Schnellstart

```bash
pnpm install          # baut auch @smart/contracts und installiert Git-Hooks
pnpm infra:up         # TimescaleDB, Mosquitto, Mailpit
pnpm --filter @smart/backend start:dev
pnpm --filter @smart/frontend start
```

## Qualitätsprüfungen

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:tz && pnpm build
pnpm infra:test
```
