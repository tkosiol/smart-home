# Etappe 5b: Pi anbinden – Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der echte Pi meldet seine Zigbee-Geräte über eine mTLS-Bridge mit 72-h-Puffer an den Produktions-Broker; das Backend verliert dabei auch über eigene Neustarts keine Messwerte; der Pi ist gehärtet, per Skript vom Mac aus deploybar und nächtlich gesichert.

**Architecture:** Neuer Ordner `gateway/` mit Compose (Mosquitto 2.1.x + Zigbee2MQTT, gepinnt), Mosquitto-Vorlage nach ADR-0020 und Z2M-Einstellungen über Umgebungsvariablen (die vorhandene `configuration.yaml` mit Geräteliste bleibt unangetastet). `infra/deploy/provision-gateway.sh` bringt Geheimnisse auf den Pi, `gateway/deploy.sh` (`pnpm gateway:deploy`) installiert und zieht vom alten Setup um. Backend: dauerhafte MQTT-Sitzung, Zeitlimits.

**Tech Stack:** wie 6a; Pi: Debian 13 (aarch64), Docker 29, `eclipse-mosquitto:2.1.2-alpine`, `koenkk/zigbee2mqtt:2.14.2` (installierte Version), `restic/restic` (gepinnt, arm64).

**Spec:** `docs/superpowers/specs/2026-10-14-etappe-5-gateway-anbindung-design.md` (Abschnitte 0, 3, 8, 9, 10), `docs/adr/0020-bridge-buffer-and-topics.md`, Übertrag aus den Plänen 5a und 6a („Ergebnis und Übertrag“).

**Planform:** schlank wie 6a; vollständiger Code an kniffligen Stellen (Mosquitto-Vorlage, Umzug mit Rückweg, Geheimnis-Transport, MQTT-Sitzung).

**Bewusste Entscheidungen:**

- **Z2M per Umgebungsvariablen:** `ZIGBEE2MQTT_CONFIG_*` setzt MQTT-Server/-Zugang, `frontend.auth_token`, `advanced.last_seen`, `availability`. Die `configuration.yaml` (Geräte, Namen, Kanal) wird nie geschrieben – der Umzug kann sie nicht beschädigen.
- **Neuer Ort `/srv/smart-gateway`:** Der alte Stack (Ordner laut `.local/pi.md`) bleibt als Rückweg unverändert liegen; der Umzug **kopiert** den Z2M-Datenordner.
- **Netzwerkschlüssel, Neukopplung, Koordinator-Tausch** bleiben außen vor (Entscheidung Till 2026-10-14).
- **Ausführung am echten Pi** gehört nicht zu den Tasks: Die Tasks bauen und testen alles lokal; Inbetriebnahme macht Claude erst nach Tills ausdrücklicher Freigabe per SSH, Schritt für Schritt nach Runbook.

## Global Constraints

- Alle Global Constraints aus 5a/6a gelten weiter (Gate je Task, keine KI-Attribution, öffentliches Repo – keine IPs, Hosts, Gerätenamen oder IEEE-Adressen des echten Pi im Repo; Platzhalter `<PI_HOST>`, `<VPS_HOST>`).
- Pi-Broker nach ADR-0020: `persistence true`, `autosave_interval 300`, `queue_qos0_messages true`, `max_queued_messages 75000`, `max_queued_bytes 75497472`, **kein** `per_listener_settings`; Bridge `cleansession false`, `keepalive_interval 20`, `restart_timeout 1 5`, `try_private true`, `notifications true`, `notification_topic gw/<id>/bridge/connection`, Topics `# out 1`, `+/set in 0`, `bridge/request/# in 0` mit Präfix `zigbee2mqtt/` ↔ `gw/<id>/z2m/`, TLS 1.2+ mit Gateway-Zertifikat.
- Lokaler Broker nicht im LAN veröffentlicht; Z2M mit Passwort am lokalen Broker; Z2M-Frontend im LAN auf 8080 nur mit `auth_token` (Spec Abschnitt 0, Punkt 2).
- Speicherlimits: Mosquitto 256 MB, Z2M 384 MB; Log-Rotation (`json-file`, 10 MB × 3).
- Geheimnisse auf dem Pi: `/srv/smart-gateway/secrets/` root `700`, Dateien `600`; nie in argv, Logs oder Repo; Transport nur per SSH-stdin.
- Ein Skript, das den Pi ändert, bricht vor jeder Änderung ab, wenn eine Vorbedingung fehlt (Zertifikat, Geheimnisse, Erreichbarkeit), und lässt den alten Stack lauffähig.

## Review Focus

1. **Umzug scheitert mittendrin** (Strom, Netz, Fehler in `compose up`): alter Stack wieder startbar, Z2M-Daten unverändert, Sensoren gekoppelt. → Tests in Task 4.
2. **Internet weg / VPS nicht erreichbar:** Z2M läuft lokal weiter, Bridge puffert, Deploy-Skript hängt nicht endlos. → Tests in Task 2 und 4.
3. **Geheimnisse:** nichts in Repo, argv, Ausgabe; Rechte stimmen auch nach erneutem Lauf. → Tests in Task 3.
4. **Z2M-Einstellungen:** Umgebungsvariablen ändern die `configuration.yaml` nicht (Geräteliste, Namen bleiben). → Test in Task 2.
5. **Backend-Neustart während Nachlieferung:** keine Messwerte verloren (dauerhafte Sitzung). → Test in Task 1.

---

### Task 1: Backend – dauerhafte MQTT-Sitzung und Zeitlimits

**Files:** `apps/backend/src/platform/mqtt/{mqtt.connection.ts,mqtt.module.ts,*.spec.ts}`, `apps/backend/src/platform/config/env.schema.ts` (`MQTT_CLIENT_ID` optional, Standard `smart-api-${STACK_NAME ?? 'local'}`), `apps/backend/src/platform/database/database.client.ts` (`statement_timeout`), `infra/compose/compose.yaml` (`MQTT_CLIENT_ID` aus `STACK_NAME`), `apps/backend/test/mqtt-session.e2e-spec.ts`.

**Verhalten:** Verbindung mit fester Client-ID, `clean: false` und MQTT-5-`sessionExpiryInterval` 86 400 s; Abos werden beim Wiederverbinden nicht doppelt angelegt (mqtt.js `resubscribe` mit bestehender Sitzung prüfen). Quittungs-Zeitlimit: ein gegateter Handler, der nach 30 s nicht fertig ist, wird quittiert und protokolliert (`describeError`-frei, nur Topic-Art); Herunterfahren wartet höchstens 10 s auf die Ingest-Warteschlange. Datenbank: `statement_timeout` 15 s.

**Tests:** Backend-App A abonniert QoS 1, wird beendet; Testpublisher sendet 50 QoS-1-Nachrichten; App B mit gleicher Client-ID startet → alle 50 kommen an. Handler, der nie fertig wird → nach 30 s (Fake-Uhr) quittiert, nächste Nachricht verarbeitet. Shutdown-Grenze 10 s. Commit `feat(backend): keep the broker session across restarts`.

---

### Task 2: Ordner `gateway/` – Compose und Konfiguration

**Files:** `gateway/{compose.yaml,mosquitto.conf.template,acl.local,README.md,render.sh}`, `gateway/test/gateway-test.sh` (Docker, lokal und in CI), `infra/compose/test/{compose.test.yaml,stack-test.sh}` (der Test-„Pi“ nutzt ab jetzt `gateway/mosquitto.conf.template` statt der eigenen Fixture), `.github/workflows/ci.yml` (shellcheck, Gateway-Test).

**`render.sh`** (läuft auf dem Pi, liest `/srv/smart-gateway/secrets/gateway.env`: `GATEWAY_ID`, `BROKER_HOST`, `BROKER_PORT`): prüft `GATEWAY_ID` gegen `^gw-[a-z0-9]{8}$` und `BROKER_HOST` gegen ein Hostnamen-Muster, ersetzt `{{GATEWAY_ID}}`, `{{BROKER_HOST}}`, `{{BROKER_PORT}}` und schreibt `/srv/smart-gateway/run/mosquitto.conf` (`600`).

**`mosquitto.conf.template`** (Werte aus den Global Constraints):

```conf
persistence true
persistence_location /mosquitto/data/
autosave_interval 300
queue_qos0_messages true
max_queued_messages 75000
max_queued_bytes 75497472

listener 1883
allow_anonymous false
password_file /mosquitto/secrets/passwd

connection {{GATEWAY_ID}}-bridge
address {{BROKER_HOST}}:{{BROKER_PORT}}
bridge_cafile   /mosquitto/secrets/ca.crt
bridge_certfile /mosquitto/secrets/gateway.crt
bridge_keyfile  /mosquitto/secrets/gateway.key
bridge_tls_version tlsv1.2
bridge_protocol_version mqttv311
cleansession false
local_clientid  {{GATEWAY_ID}}-bridge-local
remote_clientid {{GATEWAY_ID}}-bridge
keepalive_interval 20
start_type automatic
restart_timeout 1 5
notifications true
notification_topic gw/{{GATEWAY_ID}}/bridge/connection
try_private true
topic # out 1 zigbee2mqtt/ gw/{{GATEWAY_ID}}/z2m/
topic +/set in 0 zigbee2mqtt/ gw/{{GATEWAY_ID}}/z2m/
topic bridge/request/# in 0 zigbee2mqtt/ gw/{{GATEWAY_ID}}/z2m/
```

**`compose.yaml`:** Netz `gateway` (intern); `mosquitto` (2.1.2-alpine, kein Port, Volumes: `./run/mosquitto.conf` ro, `secrets/` ro, Daten-Volume, `mem_limit: 256m`, Healthcheck mit lokalem Benutzer); `zigbee2mqtt` (2.14.2, Port `8080:8080`, Gerät `${Z2M_SERIAL_DEVICE}`, Datenordner `./zigbee2mqtt-data`, `mem_limit: 384m`, `environment`: `ZIGBEE2MQTT_CONFIG_MQTT_SERVER=mqtt://mosquitto:1883`, `…_MQTT_USER`, `…_MQTT_PASSWORD` (aus `secrets/z2m.env`), `ZIGBEE2MQTT_CONFIG_FRONTEND_AUTH_TOKEN`, `ZIGBEE2MQTT_CONFIG_ADVANCED_LAST_SEEN=ISO_8601`, `ZIGBEE2MQTT_CONFIG_AVAILABILITY_ENABLED=true`, `TZ=Europe/Berlin`); beide `restart: unless-stopped`, Log-Rotation.

**Tests (`gateway-test.sh`, Docker, Wegwerf-PKI wie 5a):** `render.sh` lehnt falsche ID/Host ab, ohne Datei zu schreiben; gerenderte Konfiguration startet; ein lokaler Publisher auf `zigbee2mqtt/x` → kommt am Test-VPS-Broker als `gw/<id>/z2m/x` an; Befehl `gw/<id>/z2m/x/set` kommt lokal genau einmal an; VPS-Broker gestoppt → lokale Nachrichten werden gepuffert und nach Neustart geliefert; Z2M-Container mit Umgebungsvariablen und einer vorhandenen `configuration.yaml` (Fixture mit erfundenen Geräten) startet und die Datei ist danach byte-gleich (Prüfsumme). Commit `feat(gateway): add the gateway stack for the pi`.

---

### Task 3: `provision-gateway.sh` – Geheimnisse auf den Pi

**Files:** `infra/deploy/provision-gateway.sh`, Tests in `infra/deploy/test/run-tests.sh` (Stub-SSH), `.github/workflows/ci.yml` (shellcheck-Liste).

**Aufruf (Till, im Heimnetz):** `SMART_PI=<user@pi-host> infra/deploy/provision-gateway.sh <gateway-id> [--force]`.

**Ablauf:** prüft lokal `~/.smart-pki/gateways/<id>.crt|.key` und `~/.smart-pki/ca.crt` (sonst Abbruch mit Hinweis auf `pki.sh issue-gateway`); erzeugt Passwort für den lokalen Z2M-Benutzer und das Frontend-Token (oder behält vorhandene bei `--force`); fragt verdeckt nach B2-keyID/Application Key (`smart-pi-restic`), restic-Passwort und nach Bucket, Endpoint, healthchecks.io-URL (Enter behält bei `--force`); `BROKER_HOST` (Standard `mqtt.<APP_DOMAIN>`-Muster als Eingabe, kein Wert im Repo); Z2M-Seriengerät (Standard: einziges `/dev/serial/by-id/*` auf dem Pi, sonst Abfrage). Überträgt alles als ein `tar`-Strom per `ssh … sudo` nach `/srv/smart-gateway/secrets/` (root `700`, Dateien `600`), schreibt `gateway.env`, `z2m.env`, `passwd` (über `mosquitto_passwd` im Container auf dem Pi, Passwort per stdin), `backup.env`. Gibt am Ende das Frontend-Token **nicht** aus, sondern sagt, wo es liegt (`sudo cat …`).

**Tests:** fehlende Zertifikatsdateien → Abbruch ohne SSH; Schlüssel/Passwörter nie in Ausgabe oder argv (Stub-SSH protokolliert argv); `--force` behält Passwort/Token; Rechte im übertragenen Archiv; falsche Gateway-ID abgelehnt. Commit `feat(infra): provision the pi gateway`.

---

### Task 4: Deploy und Umzug vom Mac

**Files:** `gateway/deploy.sh`, `package.json` (`gateway:deploy`), Tests `gateway/test/deploy-tests.sh` (Stub-SSH/rsync), `docs/runbooks/gateway.md` (Abschnitt „Pi“).

**Aufruf:** `SMART_PI=<user@pi-host> pnpm gateway:deploy [--migrate]`.

**Ablauf (jede Stufe prüft vorher, bricht sauber ab):** Pi erreichbar (Zeitlimit 10 s); Geheimnisse vorhanden; `rsync` von `gateway/` nach `/srv/smart-gateway/` (ohne `secrets/`, `zigbee2mqtt-data/`); `render.sh`; `docker compose pull` (Zeitlimit). **Mit `--migrate`** (einmalig): alter Stack läuft? → Sicherung `zigbee2mqtt-data` als Tarball nach `/srv/smart-gateway/migration/<zeit>.tar.gz`; alten Stack stoppen (`docker compose -f <alter Stack>/docker-compose.yml stop`, Pfad aus `SMART_PI_OLD_STACK`); Datenordner **kopieren**; neuen Stack starten; warten bis Z2M `bridge/state` `online` lokal meldet (Zeitlimit 120 s); scheitert etwas: neuen Stack stoppen, alten wieder starten, Exit ≠ 0 mit Meldung. Ohne `--migrate`: `docker compose up -d` und Gesundheitsprüfung. Ende: Status ausgeben (Container, Bridge `1`/`0` lokal sichtbar über `$SYS`-Bridge-Status).

**Tests (Stub):** Pi nicht erreichbar → Abbruch vor Änderungen; fehlende Geheimnisse → Abbruch; Migration: Reihenfolge der Befehle (Sicherung vor Stopp, Kopie statt Verschieben); `compose up` scheitert → Rückweg ausgeführt (alter Stack gestartet); Z2M meldet nicht `online` in 120 s → Rückweg. Commit `feat(gateway): deploy and migrate the pi from the mac`.

---

### Task 5: Pi-Backups

**Files:** `gateway/compose.yaml` (Dienst `backup`, Profil `backup`, `restic/restic` gepinnt), `gateway/backup/{backup.sh,restore-test.sh}`, `gateway/systemd/{smart-gateway-backup.service,smart-gateway-backup.timer}`, `gateway/deploy.sh` (installiert Timer per `sudo`), Tests in `gateway/test/`.

**Verhalten:** nächtlich 03:30 lokal: `restic backup` von `zigbee2mqtt-data/` (ohne `log/`) und `secrets/` (verschlüsselt), Aufbewahrung 7 täglich/4 wöchentlich/6 monatlich, Ping an healthchecks.io (Start/Erfolg/Fehler); wöchentlicher Restore-Test in ein Temp-Verzeichnis (prüft `configuration.yaml` und `database.db`). Repository-Präfix eigener Bucket `smart-pi-restic`-Key (Werte nur in `backup.env`).

**Tests:** `backup.sh` mit lokalem restic-Repository (Container) sichert und stellt wieder her; fehlende `backup.env` → klarer Fehler; Ping-URLs nie im Log. Commit `feat(gateway): back up the pi nightly`.

---

### Task 6: Doku und Inbetriebnahme-Checkliste

**Files:** `docs/runbooks/gateway.md` (Pi: Voraussetzungen, Zertifikat ausstellen, in der App registrieren, `provision-gateway.sh`, `gateway:deploy --migrate`, Prüfungen, Rückweg, Backups und Restore, später: Netzwerkschlüssel/Koordinator-Tausch), Architektur-Spec 4.5 (Z2M-Einstellungen per Umgebung, `/srv/smart-gateway`), `CLAUDE.md` (Befehle `pnpm gateway:deploy`, Gateway-Tests).

**Inbetriebnahme (im Runbook, ausgeführt erst nach Tills Freigabe):** (1) `pki.sh issue-gateway` → ID notieren; (2) in der Produktion unter „Mehr → Gateways“ registrieren; (3) `provision-gateway.sh <id>`; (4) `pnpm gateway:deploy --migrate`; (5) in der App: Gateway „online“, Z2M „online“; (6) unter „Geräte → Neu erkannt“ erscheinen die Sensoren; (7) ACL-Test (Schreiben unter fremdem Präfix kommt nicht an); (8) Z2M-QoS prüfen; (9) optional: Router 2 min vom Internet trennen → Werte kommen nach. Commit `docs: describe connecting the pi`.

## Ergebnis und Übertrag

Umgesetzt subagent-gestützt: Sonnet hat umgesetzt und geprüft, Haiku hat kleine Nachbesserungen nachgeprüft, Opus das Gesamt-Review gemacht, mit einer Nachbesserungsrunde. Task 4 und 5 liefen teils parallel. Task 6 (nur Doku) hat der Controller selbst geschrieben. Reine Kleinfund-Runden bekamen kein eigenes Review, das Gesamt-Review deckt sie ab. Dieser Abschnitt hält fest, wo die Umsetzung vom Plan abweicht und was die nächsten Etappen übernehmen müssen.

### Abweichungen vom Plan (Entscheidungen)

**Backend und MQTT-Sitzung**

- **Dauerhafte MQTT-Sitzung des Backends:**
  - Subscription-Identifier werden aus dem Filter abgeleitet und sind damit über Prozesse hinweg stabil.
  - Eine Freigabesperre hält nachgelieferte Kopien unquittiert zurück, bis der Ingest abonniert hat.
  - Eine spät eintreffende Quittung nach einem Reconnect ist zulässig, weil der Broker die Paket-ID behält.
  - Steht die Sitzung beim Verbinden noch, abonniert das Backend alle Filter neu; ein verlorenes Abo heilt sich so selbst.
- **Admin-CLI ohne MQTT** (`CliModule`): Sonst übernimmt sie die feste Client-ID der laufenden API, und beim Beenden kündigt sie deren Status-Abos.

**Zigbee2MQTT und Mosquitto auf dem Pi**

- **Z2M 2.14.2 schreibt `ZIGBEE2MQTT_CONFIG_*` in `configuration.yaml`**, einschließlich Passwort und Token. Die Annahme des Plans, die Datei bleibe unverändert, stimmt nicht. Geräte, Namen und Schlüssel bleiben aber erhalten, und das Ergebnis ist bei jedem Start gleich. Deshalb hält jeder Deploy den Datenordner auf `700` und die Datei auf `600`.
- **Healthcheck über einen Benutzer `health`** mit öffentlichem Passwort. Er darf nur drei Topics lesen. Der lokale Bridge-Zustand kommt aus `gw/<id>/bridge/connection`.

**Provisionieren und Deploy**

- **`provision-gateway.sh`:**
  - Die `passwd` wird auf dem Pi mit `mosquitto_passwd -U` gehasht, mit `--network none`.
  - Das Skript braucht passwortloses `sudo` (`sudo -n`).
  - Ein mit `--force` erneutes Provisionieren behält ein von Hand ergänztes `HC_RESTORE_URL`.
- **Umzug läuft auf dem Pi** (`gateway/migrate.sh`, abgekoppelt per `systemd-run`), mit eigenem Rückweg. Ergänzt nach den Reviews:
  - Prüfungen ohne Antwort gelten als „läuft noch“; dann endet der Umzug in `failed-manual` statt den alten Stack zu starten.
  - Der alte Stack bekommt für die Dauer des Umzugs `restart=no`; das Zurücksetzen stellt die gespeicherte Richtlinie wieder her.
  - Die Kopie entsteht als `.partial` und wird erst am Ende umbenannt.
  - Normaler Deploy und `--fresh` brechen ab, solange ein fremder Z2M läuft, ein Umzugsstatus außer `done` vorliegt oder eine `.partial` übrig ist.
  - `--fresh` ist nur für einen neuen Pi.

**Backups**

- **Pings an healthchecks.io sendet das Host-Skript**, denn das restic-Image hat kein curl.
- **Eigener Timer für den Wiederherstellungstest**; `HC_RESTORE_URL` ist optional.
- **Backup und Wiederherstellungstest warten bis zu 10 min auf eine synchronisierte Uhr** (`timedatectl`). `After=time-sync.target` legt allein nur die Reihenfolge fest.
- **Die Sicherung läuft auf die laufenden Daten:**
  - `database.db` und `coordinator_backup.json` schreibt Z2M atomar.
  - `state.json` und `configuration.yaml` schreibt Z2M nicht atomar; das ist hingenommen und in `gateway/README.md` begründet.

**Inbetriebnahme**

- **Internet-Trennung mindestens 10 min statt 2 min.** Die Sensoren melden nur etwa alle 5 min.
- **Zusätzlich beschrieben: Wiederherstellung nach Verlust des Pi** (Runbook, Abschnitt 11). Die Befehle sind noch ungeprüft.

### Inbetriebnahme (2026-10-15)

- **Erster Umzug zurückgesetzt, zweiter erfolgreich.**
  - Der erste Lauf scheiterte an einem Fehler in `start.sh`, behoben in #25: `docker inspect` kennt kein `.State.RestartCount`, das Feld heißt `.RestartCount`, und die Docker-Simulation der Tests hatte das falsche Feld beantwortet.
  - Der Rückweg funktionierte wie vorgesehen: Der neue Stack war nachweislich gestoppt, die Neustart-Richtlinie wiederhergestellt, der alte Stack lief wieder, und seine Daten waren unverändert.
  - Beim zweiten Lauf war Zigbee2MQTT nach 28 s online, mit allen 8 Geräten, und die Bridge war verbunden. Danach wurde der alte Stack entfernt; sein Datenordner bleibt als zusätzliche Sicherung liegen.
- **Port 8883 war über IPv6 gesperrt.** Über IPv6 läuft die Verbindung durch UFW, über IPv4 nicht; die UFW-Regel ist nötig (Runbook Abschnitt 5, korrigiert).
- **QoS des echten Zigbee2MQTT ist 0** (am Broker der Produktion mit QoS 1 abonniert, geliefert mit 0). Es gilt die Folge aus ADR-0020; Verbesserung siehe Übertrag.
- **ACL:** Das eigene Präfix kommt an, ein fremdes wird verworfen, ohne Client-Zertifikat gibt es keine Verbindung.
- **Backup:** Das erste Backup nach B2 lief, `restic check` meldete keinen Fehler, und der Wiederherstellungstest ist bestanden.
- **Noch offen:** Nachliefer-Spitze und das retained `bridge/connection` nach einem Neustart des Brokers sind am echten Aufbau noch nicht beobachtet (optionaler Schritt 9 der Checkliste).

### Übertrag

- **Zigbee2MQTT mit QoS 1** (`device_options: qos: 1` für alle Geräte): Damit entfällt die Lücke von rund 30 s bei einem ungeplanten Ausfall des Netzes. Vorher prüfen, wie Zigbee2MQTT 2.14 das per Umgebungsvariable übernimmt.

- **Inbetriebnahme des Pi:** Runbook Abschnitt 12, erst nach Tills Freigabe. Dabei festhalten:
  - QoS des echten Z2M (erwartet 0)
  - Nachliefer-Spitze
  - retained `bridge/connection` nach einem Neustart des Brokers
- **Eigene Gateways (nach 6b):** Gateway-Assistent; die App erzeugt Zugangsdaten je Gateway und eine fertige Bridge-Konfiguration. Die Skripte sind schon auf fremde alte Stacks ausgelegt (Neustart-Richtlinie, fremder Z2M).
- **Zertifikat erneuern in der App:** fehlt noch, weil `gateway.exists` greift. Die Zertifikate gelten 2 Jahre.
- **Später vor Ort:** eigener Netzwerkschlüssel und Tausch des CC2531, beides mit Neukopplung aller Geräte (Runbook Abschnitt 12, „Später“).

### Bewusst zurückgestellt (klein)

**Backups**

- echter Test der Aufbewahrung mit rückdatierten Snapshots
- Container nach einem `SIGKILL` von `docker compose run` aufräumen (`--name`, `ExecStopPost`)
- `RESTIC_PASSWORD_FILE` statt Umgebungsvariable (bisher wie bei Z2M per `env_file`)
- Hinweise zum Umzug, wenn die Installation der Timer scheitert

**Umzug und Gateway-Test**

- Signal-Latenz während `start.sh`: Der Mac meldet dann `UNKNOWN`; das Vorgehen steht im Runbook.
- Die Richtlinie `on-failure` wird ohne ihre Zahl der Wiederholungen wiederhergestellt.
- Kein Gateway-Test mit beim Start nicht auflösbarem `BROKER_HOST`.

**Backend**

- Ein während eines Ausfalls der API gesperrtes Gateway behält sein Ingest-Abo in der Sitzung. Seine Kopien werden quittiert und verworfen.
- Ein veraltetes Status-Abo nach einem Absturz zählt nachgelieferte Kopien als frische Aktivität.
