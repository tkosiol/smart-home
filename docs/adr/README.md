# Architecture Decision Records

Neue Entscheidung: `0000-template.md` kopieren, nächste Nummer vergeben, hier eintragen. Ersetzte ADRs bekommen den Status „ersetzt durch ADR-NNNN“.

| ADR                                             | Titel                                                  |
| ----------------------------------------------- | ------------------------------------------------------ |
| [0001](0001-monorepo-pnpm-workspaces.md)        | Monorepo mit pnpm-Workspaces                           |
| [0002](0002-gateway-mqtt-bridge-mtls.md)        | Pi ↔ VPS über Mosquitto-Bridge mit mTLS und eigener CA |
| [0003](0003-central-logic-on-vps.md)            | Zentrale Logik auf dem VPS, Pi als Gateway mit Puffer  |
| [0004](0004-buffer-telemetry-never-commands.md) | Messwerte puffern, Befehle nie                         |
| [0005](0005-timescaledb-per-environment.md)     | TimescaleDB in eigenen Containern pro Umgebung         |
| [0006](0006-logical-device-vs-hardware.md)      | Logisches Gerät getrennt von Hardware                  |
| [0007](0007-passwordless-login.md)              | Passwortloser Login: Passkeys + E-Mail-Code            |
| [0008](0008-server-sessions.md)                 | Server-Sessions mit `__Host-`-Cookie                   |
| [0009](0009-users-households-roles.md)          | Benutzer, Haushalte, Rollen, Einladungen               |
| [0010](0010-sse-for-live-updates.md)            | SSE für Live-Updates                                   |
| [0011](0011-ui-library-wraps-material.md)       | Angular Material gekapselt in `@smart/ui`              |
| [0012](0012-runtime-theming.md)                 | Laufzeit-Theming mit material-color-utilities          |
| [0013](0013-i18n-transloco.md)                  | i18n mit Transloco (DE/EN)                             |
| [0014](0014-utc-everywhere.md)                  | UTC überall, Anzeige in Haushalts-Zeitzone             |
| [0015](0015-staging-and-image-promotion.md)     | Staging + Produktion mit Image-Promotion               |
| [0016](0016-forced-command-deploy.md)           | Deploy per Forced-Command-SSH-Key                      |
| [0017](0017-backups-restic-b2.md)               | Backups mit restic nach Backblaze B2 (EU)              |
| [0018](0018-self-hosting-guardrails.md)         | Self-Hosting-Leitplanken                               |
| [0019](0019-license-agpl.md)                    | Lizenz AGPL-3.0-only                                   |
| [0020](0020-bridge-buffer-and-topics.md)        | Bridge-Puffer und Topic-Konfiguration (Spike 2b)       |
