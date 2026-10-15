# Smart Home Plattform – Architektur-Spec

|        |                                                                                                                   |
| ------ | ----------------------------------------------------------------------------------------------------------------- |
| Status | Entwurf zur Freigabe                                                                                              |
| Datum  | 2026-10-11                                                                                                        |
| Umfang | Gesamtarchitektur des Smart-Home-Fundaments (Etappen 0–7). Feature-Module (z. B. Pflanzen) erhalten eigene Specs. |

> Dieses Dokument liegt in einem **öffentlichen** Repository. Es enthält keine IP-Adressen, Zugangsdaten oder privaten Details. Konkrete Werte stehen ausschließlich in der lokalen, nicht versionierten Doku (`.local/`) bzw. in Secret-Stores. Platzhalter haben die Form `<VPS_HOST>`.

---

## 1. Ziel und Kontext

Eine selbst gehostete, responsive Web-App (PWA) unter `smart.tillkosiol.de`, mit der Smart-Home-Geräte überwacht und später gesteuert werden. Geräte sind zunächst Zigbee-Geräte, die über Zigbee2MQTT auf einem Raspberry Pi im Heimnetz angebunden sind.

Das erste Ziel ist **kein einzelnes Feature, sondern ein Fundament**: Benutzer, Haushalte, Gateways, generische Geräte, Messwerte, Befehle, Benachrichtigungen, ein strenges Design-System sowie Infrastruktur, CI/CD und Betrieb. Fachliche Module (Pflanzen, Heizung, Fenster, Solar …) setzen darauf auf, ohne den Kern zu verändern.

### 1.1 Ausgangslage

- **Heimnetz:** Raspberry Pi 3B+ (1 GB RAM, Debian 13) mit Docker. Darauf laufen `eclipse-mosquitto` und `koenkk/zigbee2mqtt` (2.14.x) mit einem CC2531-Koordinator. Mosquitto ist aktuell anonym im LAN erreichbar, das Z2M-Frontend hat keinen Login, und es ist kein eigener Zigbee-`network_key` gesetzt.
- **VPS (netcup):** Debian, Docker, Nginx Proxy Manager (NPM) mit Let's Encrypt, Wildcard-DNS `*.tillkosiol.de`, Beszel-Monitoring. Mehrere andere Projekte laufen dort bereits; das Deploy-Muster „GHCR-Image + SSH-Deploy per GitHub Actions“ ist etabliert.
- **GitHub:** kostenloser Account, Repository öffentlich.

### 1.2 Erfolgskriterien für das Fundament

1. Ein beliebiges Zigbee-Gerät, das am Pi gekoppelt wird, erscheint automatisch in der App, kann einem Haushalt/Raum als logisches Gerät zugeordnet werden und zeigt Live-Werte und Verlauf.
2. Beschreibbare Fähigkeiten (z. B. Lampe an/aus) können aus der App gesteuert werden, mit sichtbarer Bestätigung oder Fehlermeldung.
3. Fällt das Internet zu Hause aus, gehen keine Messwerte verloren.
4. Ein neues Feature-Modul lässt sich hinzufügen, ohne Core-Code zu ändern.
5. Jede UI entsteht ausschließlich aus Shared Components; Themes (Farbe, Variante, Modus, Kontrast) funktionieren in jeder Komponente.
6. Jede Änderung läuft PR → CI → Staging → Freigabe → Produktion.

### 1.3 Nicht-Ziele (vorerst)

- Native Apps, Sprachassistenten, Home-Assistant-Integration
- Allgemeine Regel-Engine („Wenn X, dann Y“)
- Lokale Automationen auf dem Pi (Hybrid-Betrieb, siehe ADR-0003)
- Offline-Datensynchronisation im Frontend
- Andere Funkstandards als Zigbee (das Gateway-Modell lässt sie später zu)
- Horizontale Skalierung des Backends
- Installationsvarianten für andere (nur Web-App, alles zu Hause, getrennte Bridge) – werden durch die Self-Hosting-Leitplanken offengehalten (`2026-10-11-self-hosting-and-license-design.md`, ADR-0018) und in einer eigenen Etappe nach Etappe 6 gebaut
- Weitere Sprachen außer Deutsch und Englisch

---

## 2. Systemüberblick

```
HEIMNETZ                                      VPS
┌─────────────── Pi ───────────────────┐      ┌──────────────────────────────────────────────┐
│ Zigbee-Geräte ⇄ Koordinator (USB)    │      │ NPM :443 (TLS, Let's Encrypt)                 │
│        │                             │      │   smart.tillkosiol.de          → prod-web     │
│   zigbee2mqtt ⇄ mosquitto (lokal) ───┼─mTLS─┼─▶ :8883 (mqtt.smart.tillkosiol.de)            │
│                Bridge + Puffer       │      │   staging.smart.tillkosiol.de  → staging-web  │
└──────────────────────────────────────┘      │                                               │
  keine eingehenden Ports im Heimnetz         │ Stack smart-prod:    web · api · db · broker  │
                                              │ Stack smart-staging: web · api · db · broker  │
                                              │                      + gateway-simulator      │
                                              └──────────────────────────────────────────────┘
```

**Rollen:**

| Komponente          | Aufgabe                                                                         |
| ------------------- | ------------------------------------------------------------------------------- |
| Zigbee2MQTT (Pi)    | Übersetzt Zigbee ⇄ MQTT, beschreibt Geräte über _exposes_                       |
| Mosquitto (Pi)      | Lokaler Broker; leitet per Bridge an den VPS-Broker weiter, puffert bei Ausfall |
| Broker (VPS)        | Zentraler Mosquitto; mTLS für Gateways, ACL pro Gateway                         |
| `api` (NestJS)      | Fachlogik, REST-API, SSE, MQTT-Konsument, Hintergrundjobs                       |
| `db` (TimescaleDB)  | Postgres 17 + TimescaleDB für Stammdaten und Zeitreihen                         |
| `web` (nginx)       | Liefert die Angular-PWA aus, proxyt `/api` an `api` (Same-Origin)               |
| `gateway-simulator` | Erzeugt realistische Z2M-Nachrichten für Lokal, Staging und Tests               |

---

## 3. Infrastruktur und Umgebungen

### 3.1 Umgebungen

|             | Lokal                          | Staging                        | Produktion                            |
| ----------- | ------------------------------ | ------------------------------ | ------------------------------------- |
| URL         | `localhost:4200`               | `staging.smart.tillkosiol.de`  | `smart.tillkosiol.de`                 |
| Gerätedaten | Simulator                      | Simulator (dauerhaft)          | echter Pi                             |
| Broker      | Docker, ohne TLS, Passwort     | intern, kein öffentlicher Port | `mqtt.smart.tillkosiol.de:8883`, mTLS |
| Datenbank   | Docker                         | eigener Container              | eigener Container                     |
| Mail        | Mailpit (lokaler Mail-Catcher) | Resend, nur an Freigabeliste   | Resend                                |
| `api`/`web` | nativ (`pnpm dev`, HMR)        | Images aus GHCR                | dieselben Images wie Staging          |

Staging hat keinerlei Verbindung zu echten Geräten und kann daher nie reale Aktoren schalten. Bei Bedarf kann der Pi später eine zweite, ausschließlich ausgehende Bridge zu Staging erhalten.

### 3.2 VPS-Stacks

- Verzeichnisse `~/docker/apps/smart-prod/` und `~/docker/apps/smart-staging/`, je ein Compose-Projekt.
- Netzwerke pro Stack: ein internes Netz (`api`, `db`, `broker`, ggf. `simulator`). Nur `web` hängt zusätzlich im gemeinsamen Netz des Reverse Proxys.
- **Veröffentlichte Host-Ports:** ausschließlich `8883/tcp` des Produktions-Brokers. Docker-Port-Publishing umgeht UFW; deshalb wird bewusst nichts anderes veröffentlicht. UFW erhält trotzdem eine dokumentierte Regel für 8883.
- **Eigene Datenbank-Container** pro Umgebung (`timescale/timescaledb`, Version gepinnt), kein bereits vorhandener, geteilter Postgres-Container: Isolation, eigene Extension (TimescaleDB), unabhängige Upgrades/Backups, kein Zugriff aus dem Proxy-Netz.
- Alle Container: Image-Versionen gepinnt, `restart: unless-stopped`, Healthchecks, Log-Rotation (`json-file`, `max-size`/`max-file`), Nicht-Root-User, `read_only` wo möglich, `TZ=UTC`.
- **NPM-Proxy-Hosts:** `smart.tillkosiol.de` → `smart-prod-web:80`, `staging.smart.tillkosiol.de` → `smart-staging-web:80`, jeweils mit SSL, HSTS und HTTP/2.

### 3.3 DNS

Der vorhandene Wildcard-Eintrag `*.tillkosiol.de` deckt nur eine Ebene ab. Benötigt wird zusätzlich ein Eintrag `*.smart` (A + AAAA auf den VPS) für `staging.smart.…` und `mqtt.smart.…`. Resend nutzt die bereits verifizierte Domain `tillkosiol.de` (Region eu-west-1); Absender z. B. `Smart Home <smart@tillkosiol.de>`. Eine eigene Absender-Subdomain ist nicht nötig.

---

## 4. Gateway-Anbindung

### 4.1 Prinzip

Der Pi baut **ausgehend** eine MQTT-Bridge-Verbindung zum VPS-Broker auf (Mosquitto-Bordmittel, kein eigener Code). Im Heimnetz werden keine Ports geöffnet. Fällt die Verbindung aus, puffert der lokale Broker ausgehende Nachrichten und liefert sie nach.

### 4.2 Sicherheit: mTLS mit eigener CA

- **Eigene Zertifizierungsstelle** (ECDSA P-256), erzeugt und verwaltet per Skript aus `infra/pki/` (OpenSSL). Der private CA-Schlüssel liegt passphrase-verschlüsselt **außerhalb des Repos** (`~/.smart-pki/`) und zusätzlich im Passwortmanager.
- **Server-Zertifikat** für `mqtt.smart.tillkosiol.de` von dieser CA (Laufzeit 2 Jahre). Gateways vertrauen nur dieser CA. Kein Let's Encrypt für den Broker nötig, da sich nur eigene Clients verbinden.
- **Client-Zertifikat pro Gateway** (Laufzeit 2 Jahre), CN = `gatewayId`.
- **Sperrung** über eine CRL, die der Broker lädt.
- **Ablaufüberwachung:** Ein täglicher Job des Backends protokolliert 30 Tage vor Ablauf eines Gateway-Zertifikats und der CRL eine Warnung; die Gateway-Liste unter „Mehr → Gateways“ markiert sie (Benachrichtigungen folgen mit Etappe 7). Das Server-Zertifikat prüft das Backend nicht; dafür gibt `pki.sh status` die Restlaufzeit aus (Runbook `docs/runbooks/gateway.md`).
- **Restrisiko:** öffentlich erreichbarer Port 8883. Ohne gültiges Client-Zertifikat scheitert bereits der TLS-Handshake, bevor Mosquitto MQTT-Pakete verarbeitet. WireGuard kann später als zusätzliche Schicht davorgeschaltet werden, ohne die Architektur zu ändern.

### 4.3 VPS-Broker

- **Mosquitto 2.1.x** (Version gepinnt, ADR-0020); dasselbe Image für alle Umgebungen. `per_listener_settings true`, `allow_anonymous false`.
- **Listener 8883 (öffentlich):** `require_certificate true`, `use_identity_as_username true`, `cafile`, `certfile`, `keyfile`, `crlfile`, `tls_version tlsv1.2` (Minimum), `max_connections 20`. Der Listener entsteht nur, wenn `MQTT_TLS=on` gesetzt ist und alle Zertifikatsdateien vorhanden sind; nur der Produktions-Stack veröffentlicht den Port. Eine abgelaufene CRL sperrt alle Gateways aus, deshalb wird sie jährlich erneuert (Runbook).
- **Listener 1883 (nur internes Docker-Netz):** Passwort-Authentifizierung für `smart-api` (das Backend) und, nur lokal, im Stack-Test und auf Staging, `smart-simulator`. Zertifikate können diese Namen nie tragen (Gateway-IDs folgen dem festen Muster `gw-` plus 8 Zeichen `[a-z0-9]`).
- `persistence true`; **`queue_qos0_messages false`**, damit Befehle (QoS 0) für offline Gateways nicht aufgestaut werden; `max_queued_messages 10000` (Nachliefer-Spitze nach einem Ausfall).
- Fail2ban-Filter auf fehlgeschlagene TLS-/Auth-Versuche im Broker-Log (Betriebsschritt von Till, Runbook `docs/runbooks/gateway.md`). Docker-Port-Publishing umgeht UFW (Abschnitt 3.2); der Schutz des Ports sind mTLS und `max_connections`.

**ACL** (eine generische Regel für alle Gateways, `%u` = Zertifikats-CN):

```
pattern write gw/%u/z2m/#
pattern write gw/%u/bridge/connection
pattern read  gw/%u/z2m/+/set
pattern read  gw/%u/z2m/bridge/request/#

user smart-api
topic readwrite gw/#

user smart-simulator            # nur wenn der Simulator konfiguriert ist; <id> = seine Gateway-ID
topic write gw/<id>/z2m/#
topic write gw/<id>/bridge/connection
topic read  gw/<id>/z2m/+/set
topic read  gw/<id>/z2m/bridge/request/#
```

Unerlaubte Zugriffe verwirft der Broker still. Ein neues Gateway erfordert damit nur: Zertifikat ausstellen, im Backend registrieren (Plattform-Admin, „Mehr → Gateways“). Keine Broker-Konfigurationsänderung. Das Backend leitet Status (`bridge/connection`, `bridge/state`) aus den retained Nachrichten ab; unbekannte und gesperrte Gateways ignoriert es.

### 4.4 Topic-Schema

| Lokal (Pi)                     | Remote (VPS)                          | Richtung                                 | QoS |
| ------------------------------ | ------------------------------------- | ---------------------------------------- | --- |
| `zigbee2mqtt/#`                | `gw/<gatewayId>/z2m/#`                | Pi → VPS                                 | 1   |
| `zigbee2mqtt/+/set`            | `gw/<gatewayId>/z2m/+/set`            | VPS → Pi                                 | 0   |
| `zigbee2mqtt/bridge/request/#` | `gw/<gatewayId>/z2m/bridge/request/#` | VPS → Pi                                 | 0   |
| –                              | `gw/<gatewayId>/bridge/connection`    | Bridge-Status (`1`/`0`, inkl. Last Will) | 1   |

Schleifen zwischen ein- und ausgehenden Topics verhindert `try_private true` an der Bridge (im Spike 2b verifiziert, ADR-0020).

> **Self-Hosting-Leitplanke 1 (ADR-0018):** `gw/<gatewayId>/z2m` ist das Präfix des zentralen Betriebs. Ein Gateway wird allgemein als Broker-Verbindung + Topic-Präfix modelliert; Ingest, Befehle und Live-Updates dürfen kein bestimmtes Präfix voraussetzen (z. B. `zigbee2mqtt` beim Broker eines Nutzers).

### 4.5 Pi-Konfiguration (Ordner `gateway/`)

- Compose-Datei und Konfigurations-Vorlagen für Mosquitto und Zigbee2MQTT; Image-Versionen gepinnt.
- **Mosquitto lokal:** nicht mehr im LAN veröffentlicht; nur über das Docker-Netz für Z2M erreichbar; Passwort-Authentifizierung; `persistence true`, `autosave_interval 300`, `queue_qos0_messages true` (Z2M publiziert QoS 0), **Puffer für 72 h** (`max_queued_messages 75000`, `max_queued_bytes 75497472`; Speicherlimit des Containers als Schutz, weil die Limits die QoS-0-Queue nicht begrenzen); Bridge mit `cleansession false`, `try_private true`, `keepalive_interval 20`, `notification_topic gw/<gatewayId>/bridge/connection` (ADR-0020).
- **Zigbee2MQTT:** Die Einstellungen kommen als Umgebungsvariablen `ZIGBEE2MQTT_CONFIG_*` aus `gateway/compose.yaml` (Benutzer, Passwort und Token aus `secrets/z2m.env`); Z2M 2.14 übernimmt sie bei jedem Start und schreibt sie in `configuration.yaml`, Geräte und Namen bleiben dort erhalten (Ordner `700`, Datei `600`).
  - `advanced.last_seen: ISO_8601` (Messzeitpunkt in jeder Nachricht)
  - `availability.enabled: true` (Online-/Offline-Status pro Gerät)
  - eigener, generierter `network_key`, `pan_id`, `ext_pan_id` (Neukopplung der vorhandenen Geräte nötig): **zurückgestellt** (Entscheidung 2026-10-14), zusammen mit Neukopplung und Koordinator-Wechsel (Abschnitt 4.6) vor Ort; bis dahin läuft das vorhandene Zigbee-Netz weiter
  - Frontend im Heimnetz (Port 8080), geschützt durch `auth_token`; nicht aus dem Internet erreichbar
  - **Namen:** Die Regel „`friendly_name` ist immer die IEEE-Adresse“ entfällt (Entscheidung 2026-10-14): Die Sensoren heißen in Z2M schon nach ihren Pflanzen. Das Backend ordnet Nachrichten über `bridge/devices` (`friendly_name` ↔ IEEE-Adresse) zu und folgt Umbenennungen; stabil ist die IEEE-Adresse. In Etappe 6 schlägt die App den Z2M-Namen vor, wenn aus neu erkannter Hardware ein Gerät wird; danach gilt der Name in der App.
- **Zertifikate** auf dem Pi in einem Verzeichnis mit Rechten `600/700`.
- **Ablage und Deploy:** Der Stack liegt auf dem Pi unter `/srv/smart-gateway` (Geheimnisse in `secrets/`, root `700`/`600`, über `infra/deploy/provision-gateway.sh`). `pnpm gateway:deploy` vom Mac aus im Heimnetz (rsync, Render der Mosquitto-Konfiguration, `docker compose up -d` per SSH, Warten auf Z2M `online`); der einmalige Umzug vom alten Stack (`--migrate`) läuft auf dem Pi selbst mit eigenem Rückweg. Nicht über GitHub Actions, da der Pi von außen nicht erreichbar ist. Ablauf: `docs/runbooks/gateway.md`, Abschnitte 11 und 12.
- **Backups:** nachts restic nach B2 (Z2M-Daten und `secrets/`), wöchentlicher Wiederherstellungstest, beide als systemd-Timer mit Ping an healthchecks.io.
- **Zeit:** `systemd-timesyncd` aktiv. Der Pi hat keine RTC; siehe Abschnitt 9.

### 4.6 Koordinator-Wechsel

Der CC2531 bleibt vorerst im Einsatz. Ein späterer Wechsel erfordert die Neukopplung aller Geräte. IEEE-Adressen bleiben dabei gleich; durch die Trennung von logischem Gerät und Hardware (Abschnitt 8.4) bleiben Verlauf und Zuordnungen erhalten.

---

## 5. Repository, Dokumentation und Secrets

### 5.1 Struktur

Repository `tkosiol/smart-home`, pnpm-Workspaces.

```
smart-home/
├── apps/
│   ├── frontend/                Angular-Workspace
│   │   ├── src/app/             core/, shell/, features/*
│   │   └── projects/ui/         Design-System-Bibliothek „@smart/ui“
│   ├── backend/                 NestJS
│   └── gateway-simulator/       Node-Dienst
├── packages/
│   └── contracts/               „@smart/contracts“ (Zod-Schemas, DTO-Typen, Enums,
│                                Fehlercodes, Topic-Schema); ESM-only (Nest 12 und Angular sind ESM)
├── gateway/                     Pi: Compose, Vorlagen, Deploy-Skript
├── infra/
│   ├── compose/                 Stacks staging/prod + .env.example
│   ├── broker/                  VPS-Mosquitto-Konfiguration, ACL
│   ├── pki/                     CA-/Zertifikats-Skripte (keine Schlüssel)
│   ├── backup/                  Backup-Image (restic, supercronic)
│   └── local/                   docker-compose für Entwicklung
├── tools/                       eigene ESLint-Regeln, Skripte
├── docs/
│   ├── architecture/            Überblick, Diagramme
│   ├── adr/                     Architecture Decision Records
│   ├── guides/                  Neues Feature-Modul, neue UI-Komponente, neuer Gerätetyp
│   ├── runbooks/                Deploy, Rollback, Restore, Zertifikate (mit Platzhaltern)
│   └── superpowers/             Specs und Umsetzungspläne
├── .github/workflows/
├── CLAUDE.md                    öffentlich: Konventionen, Befehle, Architekturregeln
├── CLAUDE.local.md              gitignored: privater Kontext
└── .local/                      gitignored: private Doku
```

### 5.2 Öffentlich vs. lokal

| Ort                            | Inhalt                                                                                                                                  |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/` (öffentlich)           | Wie das System funktioniert. Konkrete Hosts/Werte nur als Platzhalter.                                                                  |
| `.local/` (gitignored)         | Server- und Pi-Zugänge, Hosts, private Runbooks, Notizen, **Secret-Inventar** (welche Secrets es gibt und wo sie liegen – keine Werte). |
| `CLAUDE.local.md` (gitignored) | Privater Kontext für Claude Code, verweist auf `.local/`.                                                                               |
| Secret-Werte                   | Ausschließlich: Passwortmanager, `.env` auf dem Server, GitHub Environment Secrets. CA-Schlüssel: `~/.smart-pki/` + Passwortmanager.    |

### 5.3 Schutz vor Secret-Leaks

1. `gitleaks` als Pre-Commit-Hook (über `lefthook`)
2. `gitleaks` im CI bei jedem PR
3. GitHub Secret Scanning mit Push Protection
4. `.env.example`-Dateien enthalten nur Platzhalter

### 5.4 Konventionen

- Sprache: Code, Bezeichner, Code-Kommentare und Commit-Messages auf Englisch; Projektdoku (`docs/`) auf Deutsch.
- Conventional Commits (geprüft per `commitlint`), Branches `feat/…`, `fix/…`, `chore/…`, Squash-Merge.
- Keine KI-Attribution in Commits oder PRs (kein `Co-Authored-By: Claude`, kein „Generated with …“).
- Node.js: aktuelles LTS, festgelegt per `.nvmrc` und `engines`; pnpm per `packageManager`-Feld.
- Dependabot (npm, Docker, GitHub Actions), gruppierte Updates.
- Jede Architekturentscheidung dieser Spec wird als ADR in `docs/adr/` festgehalten (Liste in Abschnitt 14).

---

## 6. CI/CD

### 6.1 `ci.yml` (jeder PR und Push auf `main`)

`gitleaks` → `pnpm install` (gecacht) → Lint (inkl. Modulgrenzen, Stylelint, i18n-Schlüsselprüfung) → Typecheck → Unit-Tests → Integrationstests (Testcontainers: TimescaleDB, Mosquitto) → Tests zusätzlich mit `TZ=Pacific/Chatham` → Build aller Apps → Storybook-Build + Interaktionstests → E2E (Playwright gegen den lokalen Stack).

Zusätzlich: CodeQL (eigener Workflow), Trivy-Scan der gebauten Images.

### 6.2 `deploy.yml` (Push auf `main`)

1. **Build:** Images `web`, `api`, `gateway-simulator` (linux/amd64) bauen, nach GHCR pushen als `ghcr.io/tkosiol/smart-home-<name>:<git-sha>`.
2. **Staging** (GitHub Environment `staging`, automatisch): Deploy, Migration, Smoke-Test.
3. **Produktion** (GitHub Environment `production`, manuelle Freigabe): **dieselben Images**, gleicher Ablauf.

**Deploy-Mechanismus:** Ein SSH-Key pro Environment, auf dem VPS per `authorized_keys` auf einen **Forced Command** beschränkt (`smart-deploy <env> <sha>`, Parameter per Regex validiert, kein Port-Forwarding, kein PTY). Das Deploy-Skript lädt die Compose-Dateien aus `infra/compose/` zum angegebenen Commit aus dem öffentlichen Repo, setzt `IMAGE_TAG`, führt `docker compose pull`, `docker compose run --rm api migrate` und `docker compose up -d` aus und prüft anschließend `/api/health/ready`. Schlägt die Migration fehl, wird abgebrochen und der alte Stand läuft weiter.

**Rollback:** manueller Workflow (`workflow_dispatch`) mit älterem Commit-SHA. Voraussetzung: Migrationen sind rückwärtskompatibel (Expand/Contract: erst Neues hinzufügen, später Altes entfernen).

### 6.3 Sicherheit der Workflows

- Kein `pull_request_target`; Fork-PRs erhalten keine Secrets.
- Alle Actions auf Commit-SHA gepinnt; minimale `permissions` pro Job.
- GitHub kennt nur die Deploy-Keys und den Host. **Laufzeit-Secrets** (DB-Passwort, Session-Secret, Resend-Key, VAPID-Keys, Broker-Passwörter) liegen ausschließlich in der `.env` auf dem Server.
- Branch Protection auf `main`: PR erforderlich, CI-Status erforderlich, lineare Historie, kein Force-Push. Keine Pflicht-Reviews (Solo-Entwicklung).

---

## 7. Identität, Haushalte und Berechtigungen

### 7.1 Modell

- **User** ↔ **Household** über **Membership** mit Rolle.
- **Plattform-Rolle:** `is_platform_admin` (Gateway-Registrierung, Recovery-Links, Systemmeldungen).
- **Haushalts-Rollen:**

| Rolle    | Rechte                                                                                                              |
| -------- | ------------------------------------------------------------------------------------------------------------------- |
| `viewer` | Geräte, Werte, Verlauf, eigene Benachrichtigungen ansehen                                                           |
| `member` | wie `viewer` + Geräte steuern, Geräte/Räume umbenennen                                                              |
| `owner`  | wie `member` + Gateways, Hardware-Zuordnung, Kopplungsmodus, Räume, Mitglieder, Einladungen, Haushaltseinstellungen |

Ein Haushalt hat immer mindestens einen `owner`. Registrierte User dürfen eigene Haushalte anlegen (und sind dort `owner`). Feature-Module können eigene, feinere Berechtigungen auf Basis dieser Rollen definieren.

- **Letzter Haushalt:** `users.last_household_id` merkt den zuletzt gewählten Haushalt geräteübergreifend.
- **Instanz-Einstellungen:** `instance_settings` hält das Instanz-Theme in der Datenbank; ändern darf es nur ein Plattform-Admin. Es hat Vorrang vor `config.json` und dem Build-Standard.
- **Erster Haushalt:** Ein angemeldeter User ohne Haushalt landet auf einer Einrichtungsseite, auf der er seinen ersten Haushalt anlegt.

### 7.2 Login

- **Keine Passwörter.**
- **Passkeys (WebAuthn)** als Hauptweg, `@simplewebauthn/server`. Discoverable Credentials (Login ohne E-Mail-Eingabe), `userVerification: required`. RP-ID pro Umgebung (`smart.tillkosiol.de`, `staging.smart.tillkosiol.de`, `localhost`). Fremdgeräte nutzen den Cross-Device-Flow (QR-Code + Handy).
- **E-Mail-Code** als Alternative (Versand über Resend per SMTP): 6 Ziffern, 10 Minuten gültig, einmalig, gehasht gespeichert, max. 5 Versuche; Rate-Limits: Anfordern höchstens 3 je E-Mail und 10 je IP in 15 Minuten, Prüfen höchstens 20 je IP in 15 Minuten; Code nur gültig im anfordernden Browser (Bindung über ein Nonce-Cookie); neutrale Antwort („Falls ein Konto existiert …“); Info-Mail „Neue Anmeldung“ nach jedem Login per Code; anschließend Angebot, einen Passkey anzulegen.
- **Notfall:** CLI-Befehl auf dem Server erzeugt einen einmaligen Recovery-Link für einen User (1 Stunde gültig).

> **Self-Hosting-Leitplanken 3 und 5 (ADR-0018):** Mailversand ist optional (generisches SMTP oder Resend); ohne Mail-Konfiguration ist der E-Mail-Code abgeschaltet. Passkeys setzen HTTPS mit festem Hostnamen voraus; die App erkennt einen unsicheren Kontext und erklärt ihn.

- **Erster Admin:** CLI-Befehl `create-admin` auf dem Server (auf dem VPS über `infra/deploy/admin.sh`). Keine offene Registrierung.
- **Voraussetzung:** Das E-Mail-Konto ist der Generalschlüssel und muss selbst mit 2FA gesichert sein.

### 7.3 Sessions

- Opaker Zufalls-Token (256 Bit), in der DB als SHA-256-Hash.
- Cookie `__Host-session`: `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`.
- Gleitende Laufzeit 30 Tage, absolute Höchstdauer 180 Tage.
- Gespeichert: Login-Methode, User-Agent, zuletzt aktiv. In der App einzeln widerrufbar.
- CSRF: `SameSite=Lax` + Prüfung des `Origin`-Headers bei allen ändernden Requests.

### 7.4 Einladungen

Der Owner lädt per E-Mail und Rolle ein → Mail über Resend → Link (256-Bit-Token, gehasht, 7 Tage, einmalig, an die E-Mail gebunden). Ohne Konto: Registrierung (Name, Passkey; E-Mail gilt durch den Link als bestätigt). Mit Konto: Login und Annahme. Offene Einladungen sind einsehbar, erneut sendbar und widerrufbar.

---

## 8. Backend

NestJS, TypeScript strict, Drizzle ORM, Zod (`nestjs-zod`) für Validierung und OpenAPI.

### 8.1 Modulstruktur

```
apps/backend/src/
├── platform/          config, database, mqtt, mail, push, realtime, i18n, observability
├── core/              identity, households, gateways, devices, telemetry, commands, notifications
└── modules/           Feature-Module (z. B. plants)
```

### 8.2 Abhängigkeitsregeln (per `eslint-plugin-boundaries` erzwungen)

- `modules/*` → `core/*` (nur über deren öffentliche API, d. h. `index.ts`) und `platform/*`
- `core/*` → `platform/*`, andere Core-Module nur über deren öffentliche API
- `core` importiert nie aus `modules`; Module importieren nie voneinander
- Kommunikation von Core zu Modulen über **Domain-Events** (in-process, `@nestjs/event-emitter`), z. B. `telemetry.recorded`, `device.bound`, `device.unbound`, `gateway.status-changed`

### 8.3 Drizzle

- Jedes Modul besitzt seine Tabellen in eigenen `*.schema.ts`-Dateien; `drizzle.config.ts` sammelt sie per Glob.
- Tabellennamen mit Modul-Präfix außerhalb des Cores (z. B. `plants_plants`).
- Migrationen: `drizzle-kit generate` → SQL-Dateien, die reviewt und committet werden. TimescaleDB-Spezifika (Hypertables, Kompression, Aggregate, Retention) als Custom-Migrationen.
- Migrationen laufen als eigener Schritt (`api migrate`) vor dem Start der neuen Version.
- IDs: UUIDv7. Zeitstempel: ausschließlich über den Helper `utcTimestamp()` (`timestamptz`).

### 8.4 Datenmodell (Core)

**Identität und Haushalte**

| Tabelle               | Wesentliche Felder                                                                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users`               | `id`, `email` (eindeutig, case-insensitiv), `display_name`, `locale` (`de`/`en`), `is_platform_admin`, `appearance` (JSON: Farben, Modus, Kontrast), `last_household_id`, Zeitstempel |
| `passkeys`            | `user_id`, `credential_id`, `public_key`, `counter`, `transports`, `name`, `last_used_at`                                                                                             |
| `sessions`            | `token_hash`, `user_id`, `auth_method`, `user_agent`, `created_at`, `last_seen_at`, `expires_at`, `absolute_expires_at`, `revoked_at`                                                 |
| `email_login_codes`   | `email`, `code_hash`, `browser_nonce_hash`, `attempts`, `expires_at`, `used_at`                                                                                                       |
| `webauthn_challenges` | `challenge`, `browser_nonce_hash`, `user_id` (optional), `purpose` (`register`/`login`), `expires_at`                                                                                 |
| `recovery_tokens`     | `user_id`, `token_hash`, `expires_at`, `used_at`                                                                                                                                      |
| `households`          | `id`, `name`, `timezone` (IANA)                                                                                                                                                       |
| `memberships`         | `household_id`, `user_id`, `role`                                                                                                                                                     |
| `invitations`         | `household_id`, `email`, `role`, `token_hash`, `invited_by`, `expires_at`, `accepted_at`, `revoked_at`                                                                                |
| `rooms`               | `household_id`, `name`, `sort_order`                                                                                                                                                  |
| `instance_settings`   | `id` (immer 1), `appearance` (JSON, Instanz-Theme, optional), `updated_at`, `updated_by`                                                                                              |

**Gateways, Hardware und Geräte**

| Tabelle           | Wesentliche Felder                                                                                                                                                                                                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gateways`        | `id` (= Zertifikats-CN), `household_id`, `name`, `kind` (`z2m`), `topic_prefix` (`gw/<id>/z2m`), `bridge_status`, `z2m_status` (je `online`/`offline`/`unknown`), `status_changed_at`, `last_message_at`, `cert_fingerprint`, `cert_expires_at`, `created_at`, `revoked_at`                 |
| `hardware`        | `id`, `gateway_id`, `ieee_address`, `friendly_name`, `vendor`, `model`, `description`, `definition` (JSON, Z2M-Definition inkl. _exposes_), `interview_state`, `availability`, `last_state` (JSON), `first_seen_at`, `last_seen_at`, `removed_at`; eindeutig (`gateway_id`, `ieee_address`) |
| `capabilities`    | `hardware_id`, `key` (Property-Pfad, z. B. `soil_moisture`), `kind` (`numeric`/`binary`/`enum`/`text`/`composite`), `unit`, `min`, `max`, `step`, `enum_values`, `readable`, `writable`, `is_setting`                                                                                       |
| `devices`         | **logisches Gerät:** `id`, `household_id`, `room_id`, `name`, `icon`, `created_at`, `archived_at`                                                                                                                                                                                           |
| `device_bindings` | `device_id`, `hardware_id`, `bound_at`, `unbound_at`; partielle Unique-Indizes: höchstens eine aktive Bindung pro Gerät und pro Hardware                                                                                                                                                    |

Neu entdeckte Hardware ist „nicht zugeordnet“ und kann einem bestehenden logischen Gerät zugewiesen werden (Sensor-Tausch: Verlauf läuft nahtlos weiter) oder ein neues logisches Gerät erzeugen. Nicht zugeordnete Hardware zeigt nur `last_state` als Vorschau und schreibt keine Historie. Aus Hardware ein Gerät zu machen darf nur ein `owner`; der Name des Geräts ist mit dem `friendly_name` aus Z2M vorbelegt.

`is_setting` markiert Fähigkeiten, die der Nutzer einstellt statt misst: schreibbar (`access` enthält „set“) und keine reine Aktion, z. B. Kalibrierung, Messintervall oder Warnschwelle des Bodensensors. Lesbare Messwerte ohne Schreibrecht sind nie Einstellungen. Einstellungen werden weder angezeigt (Vorschau, Gerät, Übersicht) noch als Messwerte gespeichert; es zählen nur lesbare Fähigkeiten, die keine Einstellung sind (_readings only_).

**Telemetrie**

| Tabelle               | Wesentliche Felder                                                                                                                                                   |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `device_state`        | `device_id` (PK), `state` (JSON, letzter Gesamtstand), `last_seen_at`, `availability`                                                                                |
| `measurements`        | Hypertable: `time`, `device_id`, `capability`, `value_num` (double), `value_text`, `flags` (z. B. „Zeitstempel ersetzt“); Unique (`device_id`, `capability`, `time`) |
| `measurements_hourly` | Continuous Aggregate (UTC-Stunden): `avg`, `min`, `max`, `last`, `sum`, `count` für numerische Werte (**ab Etappe 6c**; 6a speichert nur `measurements`)             |

- Chunk-Intervall 7 Tage; Kompression nach 7 Tagen (`segmentby device_id, capability`); Rohdaten-Retention 1 Jahr; Stundenaggregat unbegrenzt.
- Refresh-Policy des Aggregats mit `start_offset` von 7 Tagen, damit nachgelieferte Pufferdaten berücksichtigt werden.
- **Tageswerte** werden zur Abfragezeit aus `measurements_hourly` berechnet: `time_bucket('1 day', bucket, <household.timezone>)`, Durchschnitt als `sum(sum)/sum(count)`. Dadurch korrekt bei 23-/25-Stunden-Tagen.
- `binary` wird als 0/1 in `value_num` gespeichert, `enum` in `value_text`. `composite` und `text` landen nur in `device_state`. Einstellungen (`is_setting`) werden gar nicht gespeichert.

**Befehle und Benachrichtigungen**

| Tabelle                    | Wesentliche Felder                                                                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `commands`                 | `id`, `device_id`, `user_id`, `capability`, `value` (JSON), `status` (`pending`/`confirmed`/`failed`/`rejected`), `error_code`, `created_at`, `completed_at` |
| `notifications`            | `id`, `user_id`, `household_id`, `type`, `severity`, `params` (JSON), `created_at`, `read_at`                                                                |
| `notification_preferences` | `user_id`, `type`, `enabled`, `push`                                                                                                                         |
| `notification_cooldowns`   | `key`, `last_sent_at`                                                                                                                                        |
| `push_subscriptions`       | `user_id`, `endpoint`, `keys`, `user_agent`, `created_at`, `last_success_at`, `failure_count`                                                                |

### 8.5 Datenfluss: Messwerte (Ingest)

Der MQTT-Konsument abonniert die Präfixe aller registrierten, nicht gesperrten Gateways (`gw/<id>/z2m/#`, aus `gateways.topic_prefix`); neu registrierte Gateways kommen ohne Neustart dazu, gesperrte hören sofort auf. Z2M benennt die Topics nach dem `friendly_name`, nicht nach der IEEE-Adresse; der Konsument hält je Gateway die Zuordnung `friendly_name` → Hardware (aus `bridge/devices`, `bridge/event` und der Datenbank). Eine Umbenennung in Z2M ändert die Zuordnung, die Hardware bleibt dieselbe. Der Konsument abonniert mit QoS 1 und quittiert eine Nachricht erst, nachdem sie verarbeitet ist: Die Datenbank bestimmt das Tempo, der Broker hält zurück (`max_inflight_messages`, `max_queued_messages 10000`), so dass das Backend bei einer Nachliefer-Spitze nach einem Gateway-Ausfall nichts mehr selbst verwirft; Grenzen bleiben die Broker-Warteschlange und die noch flüchtige Backend-Sitzung (`clean: true`, Entscheidung in 5b/6b). Die interne Warteschlange ist nur ein Sicherheitsnetz (64 MiB; darüber werden Nachrichten verworfen, höchstens einmal pro Minute protokolliert). Beim Herunterfahren werden bereits angenommene Nachrichten noch verarbeitet, bevor der Messwert-Puffer geleert wird.

| Topic-Suffix                                              | Verarbeitung                                                                                                                                                               |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bridge/connection` (`gw/<id>/…`)                         | Gateway-Status setzen (5a)                                                                                                                                                 |
| `z2m/bridge/devices` (retained)                           | Hardware und Capabilities anlegen/aktualisieren (inkl. `is_setting`), Namenszuordnung erneuern; nicht mehr gelistete Hardware `removed_at`; der Koordinator wird ignoriert |
| `z2m/bridge/event`                                        | Kopplung, Interview, Umbenennen, Entfernen → Hardware und Namenszuordnung aktualisieren                                                                                    |
| `z2m/<friendly_name>/availability`                        | Verfügbarkeit von Hardware und gebundenem Gerät (kommt sie vor der Geräteliste an, wird sie gemerkt)                                                                       |
| `z2m/<friendly_name>`                                     | Gerätenachricht (siehe unten)                                                                                                                                              |
| `…/set`, `…/get`, `bridge/request/#`, sonstige `bridge/*` | ignoriert (zählt auch nicht als `last_message_at`)                                                                                                                         |

**Gerätenachricht:**

1. Hardware über (`gatewayId`, `friendly_name`) finden; unbekannt → verwerfen und höchstens einmal pro Stunde protokollieren.
2. Jedes Feld gegen die Capability prüfen (Art, Zahl, Enum-Wert); unbekannte oder ungültige Felder verwerfen und zählen, nie die ganze Nachricht.
3. Zeitstempel aus `last_seen` übernehmen, wenn er ISO 8601 mit Zone hat und plausibel ist (Abschnitt 9: nicht mehr als 2 min in der Zukunft, nicht älter als 7 Tage); sonst Empfangszeit mit Flag `time_replaced`.
4. `hardware.last_state` und `last_seen_at` aktualisieren; der Zustand rückt nur in der Zeit vor, eine verspätete Nachricht überschreibt keinen neueren Stand.
5. Bei aktiver Bindung: `device_state` upserten und Messwerte (nur lesbare Fähigkeiten, die keine Einstellung sind, nur `numeric`, `binary`, `enum`) gepuffert schreiben (Batch alle 1 s oder 500 Zeilen, `ON CONFLICT DO NOTHING` gegen Duplikate).

**Retained-Nachrichten:** Der Broker spielt beim Abonnieren die zuletzt gehaltene Nachricht je Topic ab; sie ist keine frische Meldung. Eine retained Gerätenachricht ohne eigenen plausiblen Zeitstempel wird ignoriert, eine mit Zeitstempel zählt nur, wenn sie neuer ist als der gespeicherte Stand. Die retained Geräteliste (`bridge/devices`) wird dagegen immer ausgewertet, so entsteht die erkannte Hardware auch für Geräte, die gerade nichts melden.

Fehler einer Nachricht beenden nie den Konsumenten; Nutzdaten werden nie protokolliert. Nachrichten werden nacheinander verarbeitet, damit keine der Geräteliste oder Umbenennung vorauseilt. Beim Herunterfahren wird der Batch-Puffer geleert. Das Stundenaggregat (`measurements_hourly`) entsteht erst in 6b und rechnet die Historie dann nach.

### 8.6 Datenfluss: Befehle

1. `POST /api/v1/devices/:id/commands` mit `{ capability, value }`.
2. Prüfungen: Rolle ≥ `member`, Capability `writable`, Wert im erlaubten Bereich/Enum, Gateway `online`. Ist das Gateway offline: sofortige Ablehnung mit `GATEWAY_OFFLINE`.
3. `commands`-Eintrag `pending`; Publish auf `gw/<gw>/z2m/<ieee>/set` mit **QoS 0**.
4. Bestätigung, sobald der gemeldete Zustand dem Sollwert entspricht → `confirmed`; nach 10 s ohne Bestätigung → `failed`. Ergebnis per SSE an die App.

**Grundsatz:** Messwerte werden gepuffert, Befehle nie. Verspätet ausgeführte Befehle sind gefährlich.

**Kopplungsmodus:** `POST /api/v1/gateways/:id/permit-join` (nur `owner`) → `bridge/request/permit_join` für 120 s.

### 8.7 Live-Updates (SSE)

- `GET /api/v1/households/:id/events`, Authentifizierung über das Session-Cookie, Mitgliedschaft wird geprüft.
- Event-Typen: `device.state`, `device.availability`, `gateway.status`, `hardware.discovered`, `hardware.updated`, `command.result`, `notification.created`.
- Heartbeat alle 25 s; Header `X-Accel-Buffering: no` (wirkt für NPM und `web`-nginx).
- Nach jedem (Neu-)Verbinden lädt der Client den Snapshot per REST und wendet danach nur noch Deltas an.

### 8.8 Benachrichtigungen

- Core-Schnittstelle `notify({ recipients, householdId, type, severity, params, cooldownKey? })`.
- Persistiert in der Inbox; Zustellung per Web-Push (VAPID) gemäß Nutzereinstellungen; abgelaufene Subscriptions (HTTP 404/410) werden gelöscht.
- Texte werden in der Sprache des Empfängers aus `type` + `params` erzeugt.
- Abklingzeit pro `cooldownKey` verhindert Wiederholungen.
- **Core-Meldungen:** Gateway > 15 min offline, Gerät nicht verfügbar, Batterie niedrig, Zertifikat läuft bald ab.
- Feature-Module erzeugen eigene Typen (z. B. Pflanze zu trocken/zu nass).
- iOS: Web-Push nur, wenn die PWA zum Home-Bildschirm hinzugefügt wurde (iOS ≥ 16.4).

### 8.9 API

- REST unter `/api/v1`, Request-/Response-Schemas aus `@smart/contracts`, OpenAPI generiert (Swagger-UI nur lokal und auf Staging).
- Einheitliches Fehlerformat `{ code, params, traceId }`; Fehlercodes als Enum in `@smart/contracts`.
- Mandantentrennung: Guards prüfen Haushalt und Rolle (`@RequireRole('member')`); Repository-Methoden für haushaltsbezogene Daten verlangen die `householdId` als Pflichtparameter.
- Rate-Limiting (`@nestjs/throttler`) auf allen Auth-Endpunkten.
- Telemetrie-Abfrage: `GET /api/v1/devices/:id/telemetry?capability=&from=&to=&resolution=auto|raw|hour|day` (bei `auto` je nach Zeitraum).
- Health: `/api/health/live` (Prozess läuft), `/api/health/ready` (DB und Broker erreichbar).

### 8.10 Hintergrundjobs

`@nestjs/schedule` (Single Instance, keine verteilten Locks nötig; bei späterer Skalierung Postgres-Advisory-Locks): Verfügbarkeits- und Offline-Prüfungen, Aufräumen abgelaufener Codes/Sessions/Einladungen, Zertifikatsablauf.

### 8.11 Mail

Schnittstelle `MailSender` mit einem Adapter, `SmtpMailSender` (nodemailer, `SMTP_URL`): Staging und Produktion versenden über Resend per SMTP, lokal und im Stack-Test fängt Mailpit die Mails ab. Ohne `SMTP_URL` ist der Versand abgeschaltet (`DisabledMailSender`) und damit der E-Mail-Code. Templates pro Sprache. Staging versendet nur an eine Freigabeliste (`MAIL_ALLOWLIST`).

---

## 9. Zeit und Zeitzonen

1. **Speichern:** ausschließlich `timestamptz`, Session-Zeitzone der DB fest `UTC`, Container `TZ=UTC`.
2. **Transport:** ISO 8601 mit `Z`. Zod lehnt Zeitstempel ohne Offset ab.
3. **Zeitstempel vom Pi:** `last_seen` mit Offset → in UTC umgerechnet.
4. **Plausibilisierung:** Zeitstempel > 2 min in der Zukunft oder älter als das Pufferfenster (7 Tage) → Empfangszeit verwenden, Messwert mit Flag markieren. Hintergrund: Der Pi 3B+ hat keine RTC; nach einem Neustart ohne Internet ist seine Uhr bis zur NTP-Synchronisation falsch. Ein RTC-Modul (z. B. DS3231) ist optional.
5. **Anzeige:** in der Zeitzone des Haushalts (`households.timezone`), über eigene Pipes in `@smart/ui` auf Basis von `Intl.DateTimeFormat`. Angulars `DatePipe` ist per Lint verboten.
6. **Reine Datumswerte:** DB-Typ `date`, API `YYYY-MM-DD`, nie als `Date`-Objekt verarbeitet.
7. **Tageswerte:** zeitzonenbewusste Buckets (Abschnitt 8.4).
8. **Zeitpläne** (später): lokale Uhrzeit + IANA-Zeitzone; nicht existierende Zeit (Frühjahr) → nächste gültige Zeit; doppelte Zeit (Herbst) → einmalige Ausführung.
9. **Dauern** (Cooldowns, Timeouts) sind immer Zeitspannen, nie Uhrzeiten.
10. **Tests:** feste Testfälle für Umstellungstage; komplette Testsuite zusätzlich mit `TZ=Pacific/Chatham`.

---

## 10. Frontend

### 10.1 Basis

Aktuelle Angular-Version (zum Start gepinnt): Standalone Components, Signals, Zoneless, `OnPush`, neue Control-Flow-Syntax. Typisierte Reactive Forms (Signal Forms werden zum Start auf Stabilität geprüft).

```
apps/frontend/src/app/
├── core/        Auth, API-Client, SSE, i18n, aktueller Haushalt, Guards, Fehlerbehandlung, Theme-Service
├── shell/       App-Rahmen: adaptive Navigation, Top-Bar, Haushalts-Wechsler, Offline-Banner
└── features/    auth, dashboard, devices, gateways, households, notifications, settings
                 (später plants, heating …); jedes Feature als lazy geladene Route
```

### 10.2 Design-System `@smart/ui`

```
apps/frontend/projects/ui/src/lib/
├── tokens/        Theme-Erzeugung, semantische Tokens, Breakpoints
├── layout/        ui-page, ui-stack, ui-grid, ui-section
├── components/    ui-button, ui-icon-button, ui-card, ui-list, ui-text-field, ui-select,
│                  ui-switch, ui-chip, ui-badge, ui-dialog (Service), ui-snackbar (Service),
│                  ui-empty-state, ui-error-state, ui-skeleton, ui-chart, ui-value-display,
│                  ui-device-tile …
└── pipes/         ui-datetime, ui-relative-time, ui-unit
```

Angular Material (M3) ist ein internes Implementierungsdetail von `@smart/ui`.

### 10.3 Verbindliche Regeln (maschinell geprüft)

1. Features importieren UI ausschließlich aus `@smart/ui` (öffentliche API). Importe aus `@angular/material`, `@angular/cdk` oder Interna von `@smart/ui` sind außerhalb der Bibliothek verboten (ESLint).
2. **Feature-Komponenten haben kein eigenes CSS** (kein `styles`, kein `styleUrl`, keine Style-Dateien) – eigene ESLint-Regel. Layout ausschließlich über Layout-Komponenten. Fehlt etwas, entsteht eine neue `ui-*`-Komponente.
3. In `@smart/ui` keine festen Werte außerhalb der Token-Dateien: keine Farben, keine Längen (`stylelint-declaration-strict-value`). Komponenten verwenden ausschließlich **Farbrollen** (`--mat-sys-*`, `--smart-*`).
4. Anpassungen an Material-Komponenten nur über die offiziellen Override-Mixins (`mat.*-overrides`), keine Selektoren auf Material-Interna.
5. Datumsformatierung nur über `@smart/ui`-Pipes.

### 10.4 Token-Ebenen

| Ebene      | Inhalt                                                                                                    |
| ---------- | --------------------------------------------------------------------------------------------------------- |
| Referenz   | M3-Tonpaletten aus der Grundfarbe                                                                         |
| System     | `--mat-sys-*` (Farbe, Typografie, Form, Elevation) + `--smart-*` (Abstände, Größen, Statusfarben, Motion) |
| Komponente | Material-Overrides innerhalb von `@smart/ui`                                                              |

### 10.5 Theme-System (nach Vorbild Material Theme Builder)

- Grundlage: `@material/material-color-utilities` (dieselbe Bibliothek wie der Theme Builder).
- Einstellbar pro User: **Grundfarbe** (Vorschläge + frei), **Schema-Variante** (Tonal Spot (Standard), Neutral, Vibrant, Expressive, Fidelity, Content, Monochrome), **Modus** (System/Hell/Dunkel), **Kontrast** (Standard/Mittel/Hoch; `prefers-contrast: more` wird respektiert).
- Ein `ThemeService` berechnet das vollständige Schema und setzt die `--mat-sys-*`-Farbrollen zur Laufzeit; reagiert auf Systemänderungen (Farbschema, Kontrast).
- **Statusfarben** (`dry`, `ok`, `wet`, `warning`, `offline` …) als Custom Colors, an die Grundfarbe harmonisiert, jeweils mit den Rollen `color`, `on-color`, `container`, `on-container` für alle Modi und Kontraststufen.
- **Kein Aufblitzen:** Das Standard-Theme wird beim Build als CSS erzeugt; die User-Einstellung wird zusätzlich lokal zwischengespeichert und von der externen Datei `theme-boot.js` vor dem Angular-Start angewendet (die CSP erlaubt Skripte nur von `'self'`, Inline-Skripte sind gesperrt).
- Persistenz am User (`users.theme`), dadurch auf allen Geräten gleich.
- Nicht vorgesehen: Theme pro Haushalt, Farbextraktion aus Bildern (später nachrüstbar).

### 10.6 Responsives Layout

M3-Fensterklassen (Compact < 600 px, Medium 600–839 px, Expanded ≥ 840 px). Navigation: Navigation Bar (Compact), Navigation Rail (Medium), Navigation Drawer (Expanded). Umgesetzt als `ui-adaptive-shell`.

### 10.7 Erweiterbarkeit

Feature-Module registrieren sich über `provideFeature({ moreEntries, overviewCards })`: Einträge der „Mehr“-Seite und Karten der Übersicht. Ab Etappe 6b ersetzen anpassbare Blöcke (`overviewBlocks`) die Karten (`docs/superpowers/specs/2026-10-15-designkonzept-design.md`, Abschnitt 5). Die Routen bleiben lazy in `app.routes.ts`. Die Gerätedetailseite des Cores rendert registrierte Widgets passend zu den Capabilities des Geräts, ohne die Module zu kennen; das Registrieren von `deviceWidgets` kommt mit Etappe 6. Module importieren sich nicht gegenseitig.

### 10.8 Daten und Zustand

Signal-basierte Services pro Feature (kein NgRx). Typen aus `@smart/contracts`; in der Entwicklung zusätzliche Zod-Validierung von API-Antworten. SSE-Events aktualisieren die Services direkt.

### 10.9 Weitere Bausteine

- **Diagramme:** Apache ECharts (tree-shaken), gekapselt in `ui-chart`, Farben aus Tokens, Markierungsbereiche (z. B. „zu trocken“).
- **PWA:** Angular Service Worker; installierbar; App-Shell offline mit Offline-Banner; Web-Push über `SwPush`; Hinweis „Neue Version verfügbar“.
- **Schriften/Icons:** Roboto Flex und Material Symbols, selbst gehostet (keine Anfragen an Google).
- **i18n:** Transloco, Deutsch und Englisch, Sprachumschalter, Übersetzungsdateien pro Feature (lazy geladen), CI prüft fehlende/ungenutzte Schlüssel. Die API liefert Fehlercodes, keine Texte.
- **Storybook** für `@smart/ui`: alle Komponenten und Varianten, Umschalter für Grundfarbe, Variante, Modus, Kontrast und Sprache, Interaktionstests, axe-Prüfung. Veröffentlichung über GitHub Pages wird in Etappe 3 entschieden.
- **Barrierefreiheit:** Ziel WCAG 2.2 AA.
- **Security-Header** (`web`-nginx): strikte CSP (Skripte nur `'self'`; Inline-Styles erlaubt, weil der Service Worker `index.html` byte-genau zwischenspeichert und kein Nonce pro Antwort eingefügt werden kann), HSTS, `frame-ancestors 'none'`, `Referrer-Policy`, `Permissions-Policy`.

---

## 11. Betrieb

### 11.1 Fehlerbehandlung

- **Backend:** globaler Exception-Filter (`{ code, params, traceId }`); unerwartete Fehler mit Stacktrace im Log, Nutzer sieht nur die `traceId`.
- **MQTT:** automatische Wiederverbindung mit Backoff, erneutes Abonnieren; der retained Gerätelisten-Topic sorgt für Resync.
- **Frontend:** globaler `ErrorHandler` + HTTP-Interceptor → übersetzte Snackbar; `401` → Login; SSE-Wiederverbindung mit Backoff; standardisierte Zustände für Laden/Leer/Fehler; Frontend-Fehler werden an `/api/v1/client-errors` gemeldet und landen im Backend-Log.

### 11.2 Logging und Monitoring

- `pino` (JSON) mit `traceId` pro Request (AsyncLocalStorage); Docker-Log-Rotation.
- **Beszel** (bereits vorhanden) für Host- und Container-Metriken.
- **UptimeRobot** prüft `/api/health/ready` (Produktion) alle 5 Minuten.
- **healthchecks.io** überwacht Backup-Jobs (VPS, Pi) und den Zertifikats-Check (Alarm, wenn ein Job ausbleibt).
- In-App-Meldungen für Gateway-, Geräte- und Zertifikatsprobleme (Abschnitt 8.8).

### 11.3 Backups

- **Werkzeug:** restic, verschlüsselt, Ziel **Backblaze B2 (Region EU)**, eigener Bucket und eigener, auf den Bucket beschränkter Application Key pro Host.
- **VPS (nächtlich, Container `backup` im Produktions-Stack, supercronic):** `pg_dump` (Custom-Format) per `restic --stdin-from-command`, Stack-Verzeichnis (Compose-Datei, `.env`, später Broker-Konfiguration inkl. CRL). Aufbewahrung: 7 täglich, 4 wöchentlich, 6 monatlich. Kein Host-Dienst, da auf dem VPS keine Root-Rechte verfügbar sind.
- **Pi (nächtlich):** Z2M-Daten (`coordinator_backup.json`, `database.db`, `configuration.yaml`), Mosquitto-Konfiguration.
- **Restore-Test (monatlich, automatisiert):** Wiederherstellung des letzten Dumps in eine Wegwerf-Datenbank `restore_check` derselben Instanz, Prüfung der Migrationstabelle, danach Löschen; Ergebnis an healthchecks.io.
- **Runbooks** für Restore (inkl. TimescaleDB-Restore-Schritte) und Pi-Neuaufbau (OS flashen → `gateway:deploy` → Z2M-Backup einspielen).

### 11.4 Sicherheit im Betrieb

CodeQL, Trivy, Dependabot-Alerts, `pnpm audit` im CI; Container ohne Root, `read_only` wo möglich; unattended-upgrades auf VPS und Pi (prüfen/aktivieren); Runbook zur Secret-Rotation.

---

## 12. Teststrategie

| Ebene               | Werkzeug                                         | Inhalt                                                                                                 |
| ------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Contracts           | Vitest                                           | Schemas, Zeit-Parsing                                                                                  |
| Backend Unit        | Vitest                                           | Fachlogik, Capability-Mapping, Zeit-/DST-Fälle                                                         |
| Backend Integration | Vitest + Testcontainers (TimescaleDB, Mosquitto) | Ingest, Befehle, SSE, Migrationen von leerer DB, **Mandantentrennung** (jeder Endpunkt mit Fremd-User) |
| UI-Komponenten      | Storybook-Interaktionstests + axe                | jede `ui-*`-Komponente in allen Varianten und Themes                                                   |
| Frontend            | Vitest + Angular Testing Library                 | Feature-Logik, Services                                                                                |
| E2E                 | Playwright gegen den lokalen Stack               | Login per virtuellem Passkey, Gerät zuordnen, Live-Wert, Befehl, Gateway-Ausfall                       |

**Simulator-Szenarien** (deterministisch, steuerbar für Tests): Sensor trocknet aus; Gateway 1 h offline mit gebündelter Nachlieferung; Gerät neu gekoppelt mit neuer IEEE-Adresse; doppelte Nachrichten; ungültige Payloads; Zeitumstellung; Befehl ohne Bestätigung.

Umsetzung testgetrieben (TDD).

---

## 13. Etappen

Jede Etappe erhält einen eigenen, detaillierten Umsetzungsplan in `docs/superpowers/plans/`.

Reihenfolge ab Etappe 4 (Entscheidung 2026-10-13): 4a → 4c → 5 → 6 → 7 → 8 → 4b. Passkeys und Sicherheitsseite (4b) folgen nach dem Pflanzenmodul; Details in `2026-10-13-etappe-4-identity-haushalte-design.md`, Abschnitt 2.

| #   | Etappe                    | Ergebnis                                                                                                                                                     |
| --- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0   | Vorbereitung (gemeinsam)  | GitHub-Repo, Accounts (Resend, Backblaze B2, UptimeRobot, healthchecks.io), DNS (`*.smart`)                                                                  |
| 1   | Repo-Fundament            | Monorepo-Gerüst, Lint-/Boundary-Regeln, gitleaks, lefthook, commitlint, CI, Doku-Gerüst + ADRs, `CLAUDE.md`, `.local/`, lokales docker-compose               |
| 2   | Durchstich bis Produktion | „Hello World“ über die komplette Pipeline (PR → CI → Staging → Freigabe → Prod) inkl. Health, Deploy-Skript, Backups (VPS; Pi folgt in Etappe 5), Monitoring |
| 2b  | Spike: Bridge-Puffer      | Verifikation von Puffer, Nachlieferung, Schleifenfreiheit und `last_seen` bei Internetausfall (Wegwerf-Code); Ergebnis als ADR                               |
| 3   | Design-System             | Tokens, Theme-Service, erste UI-Komponenten, App-Shell, Storybook, i18n, PWA; visuelle Festlegungen gemeinsam                                                |
| 4   | Identity und Haushalte    | Passkeys, E-Mail-Code, Sessions, Einladungen, Rollen, Sicherheitsseite                                                                                       |
| 5   | Gateway-Anbindung         | PKI, Produktions-Broker, Pi-Härtung + Bridge, Gateway-Registrierung, Simulator, Pi-Backups                                                                   |
| 6   | Geräte und Telemetrie     | Hardware-Erkennung, Zuordnung, Ingest, Speicherung, SSE, generische Geräteansichten mit Diagrammen, Befehle, Kopplungsmodus                                  |
| 7   | Benachrichtigungen        | Inbox, Web-Push, Einstellungen, Core-Meldungen                                                                                                               |
| 8   | Pflanzenmodul             | eigenes Brainstorming und eigene Spec, sobald die Sensoren in Betrieb sind                                                                                   |
| 9   | Self-Hosting-Paket        | Compose-Profile für die Szenarien, Installationsskript, Multi-Arch-Images, Releases, englische README; eigene Spec                                           |

Etappe 6 ist geteilt: **6a** Geräte erkennen, Messwerte speichern und anzeigen; **6b** Designsprache, Hinweise (`core/attention`) und anpassbare Übersicht (`docs/superpowers/specs/2026-10-15-designkonzept-design.md`); **6c** Räume, Verläufe, SSE, Befehle und Kopplungsmodus in der neuen Sprache.

---

## 14. Architekturentscheidungen (ADRs)

| ADR  | Entscheidung                                                                               |
| ---- | ------------------------------------------------------------------------------------------ |
| 0001 | Monorepo mit pnpm-Workspaces (kein Nx)                                                     |
| 0002 | Pi ↔ VPS über Mosquitto-Bridge mit mTLS und eigener CA                                     |
| 0003 | VPS ist zentrale Logik; Pi ist Gateway mit Messwert-Puffer (kein Hybrid)                   |
| 0004 | Messwerte werden gepuffert, Befehle nie                                                    |
| 0005 | TimescaleDB in eigenen Containern pro Umgebung                                             |
| 0006 | Logisches Gerät getrennt von Hardware (Bindungen mit Historie)                             |
| 0007 | Passwortlos: Passkeys + E-Mail-Code (Resend), keine Recovery-Codes                         |
| 0008 | Server-Sessions mit `__Host-`-Cookie statt JWT                                             |
| 0009 | Benutzer, Haushalte, Mitgliedschaften mit Rollen; Einladung als einziger Registrierungsweg |
| 0010 | SSE statt WebSocket für Live-Updates                                                       |
| 0011 | Angular Material gekapselt in `@smart/ui`; Features ohne eigenes CSS                       |
| 0012 | Laufzeit-Theming mit `material-color-utilities`                                            |
| 0013 | i18n mit Transloco, Deutsch und Englisch                                                   |
| 0014 | UTC überall, Anzeige in Haushalts-Zeitzone                                                 |
| 0015 | Staging + Produktion mit Image-Promotion und manueller Freigabe                            |
| 0016 | Deploy per Forced-Command-SSH-Key                                                          |
| 0017 | Backups mit restic nach Backblaze B2 (EU)                                                  |
| 0018 | Self-Hosting-Leitplanken                                                                   |
| 0019 | Lizenz AGPL-3.0-only                                                                       |
| 0020 | Bridge-Puffer (72 h) und Topic-Konfiguration, Mosquitto 2.1.x (Ergebnis Spike 2b)          |

---

## 15. Risiken und Annahmen

| Risiko / Annahme                                                             | Umgang                                                                                      |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| CC2531 ist leistungsschwach (begrenzte direkte Geräte, instabile Interviews) | Router-Geräte (netzbetrieben) entlasten; Austausch später ohne Datenverlust (Abschnitt 4.6) |
| SD-Karte des Pi kann ausfallen                                               | Nächtliche Z2M-Backups, Pi als Code reproduzierbar, Runbook                                 |
| Pi ohne RTC                                                                  | Zeitstempel-Plausibilisierung; optional RTC-Modul                                           |
| Bridge-Puffer verhält sich anders als erwartet                               | Spike in Etappe 2b vor dem Bau der Gateway-Anbindung                                        |
| VPS ist Single Point of Failure                                              | Akzeptiert; externe Überwachung, Backups, Runbooks                                          |
| E-Mail-Konto ist Generalschlüssel                                            | Voraussetzung: 2FA auf dem Mail-Konto; Info-Mail bei jedem Code-Login                       |
| Resend und Backblaze sind US-Anbieter                                        | Mail-Adapter austauschbar; Backups vor Übertragung verschlüsselt, EU-Region                 |
| Exakte Z2M-Payloads der Pflanzensensoren unbekannt                           | Fundament ist gerätetyp-agnostisch; Pflanzenmodul erst mit echten Daten                     |
