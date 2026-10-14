# Etappe 5a: Broker und Gateways – Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Der Produktions-Broker nimmt Gateways nur mit Zertifikaten der eigenen CA an; das Backend kennt registrierte Gateways mit Online-Status und Zertifikatsablauf; ein Simulator liefert lokal, auf Staging und im Stack-Test Z2M-Nachrichten wie der echte Pi.

**Architecture:** `infra/pki/pki.sh` (OpenSSL) erzeugt CA, Server- und Gateway-Zertifikate und die CRL außerhalb des Repos; `infra/deploy/broker-certs.sh` bringt sie auf den VPS. Das Broker-Image schaltet den mTLS-Listener 8883 nur bei eingebundenen Zertifikaten ein. Neues Core-Modul `core/gateways` (Registrierung per Zertifikat, Status aus retained MQTT-Nachrichten, Ablauf-Job), Feature `gateways` im Frontend, eigene Anwendung `apps/gateway-simulator`.

**Tech Stack:** wie 4c; Mosquitto `eclipse-mosquitto:2.1.2-alpine` (wie bisher), `mqtt` 5.16.0 (vorhanden), OpenSSL in Skripten, `node:crypto` `X509Certificate` im Backend. Keine neuen npm-Abhängigkeiten außer für den Simulator (`mqtt` 5.16.0).

**Spec:** `docs/superpowers/specs/2026-10-14-etappe-5-gateway-anbindung-design.md` (Abschnitte 0, 2–7, 9, 10 soweit 5a) und `docs/adr/0020-bridge-buffer-and-topics.md`. Baut auf `feat/ui-shell-entry` (darunter 4c, 4a; noch nicht gemergt).

**Planform:** schlank wie 4c – vollständiger Code nur an sicherheitsrelevanten und kniffligen Stellen (CN-Muster, Zertifikatsprüfung, ACL, Broker-Einstieg, Status-Zuordnung); sonst Verhalten, Schnittstellen und konkrete Tests.

**Bewusste Entscheidungen:**

- **Gateways je Haushalt:** Liste, Registrierung und Sperrung hängen am aktuellen Haushalt (`/api/v1/households/:householdId/gateways`). Registrieren und Sperren dürfen nur Plattform-Admins, die dort owner sind; owner sehen die Liste.
- **CRL-Ablauf als Datei statt Umgebungsvariable:** `pki.sh` schreibt `crl-next-update` (ISO 8601) neben die CRL, `broker-certs.sh` kopiert beides; das Backend liest die Datei (Spec 6.3 nannte eine Variable – eine Datei braucht keinen Eingriff in `.env`).
- **Veröffentlichter Port über `.env`:** `MQTT_PUBLIC_PORT` (Produktion `8883`, sonst `127.0.0.1:18883`); `provision.sh` schreibt den Wert. So bleibt es bei einer `compose.yaml`.
- **Status unbekannter Gateways merken:** Der Konsument hält den letzten Status jeder Gateway-ID im Speicher (höchstens 1 000 IDs). Wird ein Gateway danach registriert, übernimmt es diesen Status sofort, statt bis zum nächsten Wechsel „unbekannt“ zu zeigen.

## Global Constraints

- Alle Global Constraints aus Plan 4c gelten weiter (Prüfung am Ende jeder Task: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`; bei Broker/Compose/Skripten zusätzlich `bash infra/deploy/test/run-tests.sh`, `bash infra/pki/test/run-tests.sh` und `sh infra/compose/test/stack-test.sh`; keine KI-Attribution; öffentliches Repo ohne Hosts, IPs, E-Mails, Schlüssel).
- Gateway-ID: `^gw-[a-z0-9]{8}$`, zugleich Zertifikats-CN. Andere CNs werden von `pki.sh`, Backend und Simulator-Konfiguration abgelehnt.
- Schlüssel und CA nie im Repo, nie in Logs, nie in der Datenbank; `~/.smart-pki/` mit `700`/`600`. Das Backend speichert nur Fingerabdruck und Ablauf des öffentlichen Zertifikats; eingefügte Texte mit `PRIVATE KEY` werden abgelehnt und nicht protokolliert.
- Broker nach ADR-0020 (VPS-Seite): `per_listener_settings true`, `queue_qos0_messages false`, Listener 8883 mit `require_certificate true`, `use_identity_as_username true`, `crlfile`, `tls_version tlsv1.2`, `max_connections 20`; ACL:

  ```
  pattern write gw/%u/z2m/#
  pattern write gw/%u/bridge/connection
  pattern read  gw/%u/z2m/+/set
  pattern read  gw/%u/z2m/bridge/request/#

  user smart-api
  topic readwrite gw/#
  ```

  plus Simulator-Benutzer nur für sein eigenes Präfix (Task 3).

- Topics: `gw/<id>/bridge/connection` (`1`/`0`, retained), `<topic_prefix>/bridge/state` (`online`/`offline` oder JSON `{"state":"online"}`, retained), `topic_prefix` = `gw/<id>/z2m`.
- Mandantentrennung wie 4c: Haushaltspfade mit `HouseholdGuard` + `@RequireRole`, fremde/unbekannte IDs → `404`.
- Bundle: initial < 480 kB (Fehler); Startcode importiert nur `@smart/ui/shell`; die Gateway-Seite ist lazy.

## Review Focus

1. **Eingefügtes Zertifikat in allen Formen:** Kette mit mehreren Zertifikaten, versehentlich mitkopierter privater Schlüssel, CRLF/Leerzeilen, abgelaufen, noch nicht gültig, fremde CA, falsches CN, schon registriert → definierte Antwort, kein Schlüssel gespeichert oder protokolliert. → Tests in Task 5.
2. **Gateway eines anderen Haushalts:** Liste, Sperren und Registrieren mit fremder `householdId` oder fremder Gateway-ID → `404`, nichts geändert. → Mandanten-Tabellentest in Task 5.
3. **Status nach Neustart und späte Registrierung:** `api` startet neu → Status aus retained Nachrichten stimmt sofort; Gateway meldet sich vor seiner Registrierung → nach dem Registrieren sofort „online“. → Tests in Task 6.
4. **Broker weg und wieder da:** Abonnements kommen nach einem Broker-Neustart zurück, Status aktualisiert sich weiter. → Test in Task 6.
5. **Abgelaufene oder gesperrte Zertifikate und CRL:** gesperrtes, abgelaufenes oder fremdes Zertifikat scheitert am Broker; CRL kurz vor Ablauf wird gemeldet. → Tests in Task 2, 3 und 6.

---

### Task 1: Contracts – Gateways

**Files:** `packages/contracts/src/gateways.ts` (+ `.spec.ts`), `packages/contracts/src/api-error.ts`, `packages/contracts/src/index.ts`.

**Interfaces (Produces):**

```ts
export const GATEWAY_ID_PATTERN = /^gw-[a-z0-9]{8}$/;
export const gatewayIdSchema; // string, regex GATEWAY_ID_PATTERN
export const GATEWAY_STATUSES = ['online', 'offline', 'unknown'] as const;
export type GatewayStatus = (typeof GATEWAY_STATUSES)[number];
export const GATEWAY_WARNINGS = ['certExpiring', 'certExpired', 'crlExpiring'] as const;
export const gatewaySchema = z.object({
  id, name, kind: z.literal('z2m'), topicPrefix,
  bridgeStatus, z2mStatus, statusChangedAt: nullable ISO, lastMessageAt: nullable ISO,
  certExpiresAt: ISO, revokedAt: nullable ISO, warnings: z.array(z.enum(GATEWAY_WARNINGS)),
});
export const gatewayRegisterSchema = z.object({
  name: displayNameSchema,
  certificate: z.string().check(z.minLength(1), z.maxLength(20_000)),
});
```

Neue Fehlercodes: `gateway.invalidCertificate`, `gateway.exists`, `gateway.caMissing` (+ Texte de/en in der Wurzelübersetzung wie in 4c Task 1).

**Tests:** ID-Muster akzeptiert `gw-a1b2c3d4`, lehnt `gw-A1B2C3D4`, `gw-a1b2c3d`, `smart-api`, `api` ab; `gatewaySchema` mit/ohne Warnungen; Zertifikat über 20 000 Zeichen abgelehnt. Nach Änderung `pnpm packages:build`. Commit `feat(contracts): describe gateways`.

---

### Task 2: PKI-Skripte und Zertifikate auf den VPS

**Files:** `infra/pki/pki.sh`, `infra/pki/README.md` (kurz, Deutsch), `infra/pki/test/run-tests.sh`, `infra/deploy/broker-certs.sh` (+ Tests in `infra/deploy/test/run-tests.sh`), `.github/workflows/ci.yml` (Job `ops`: shellcheck und `bash infra/pki/test/run-tests.sh`).

**`pki.sh`:** Bash, `set -euo pipefail`, OpenSSL; Verzeichnis `SMART_PKI_DIR` (Standard `~/.smart-pki`), angelegt mit `700`, alle Dateien `600` (`umask 077`). Befehle wie Spec 4: `init-ca`, `issue-server <host>`, `issue-gateway [<id>]`, `revoke <id>`, `crl`, `status`. ECDSA P-256 (`prime256v1`), SHA-256; CA 10 Jahre (`basicConstraints critical, CA:true`, `keyUsage keyCertSign, cRLSign`), Server 2 Jahre (`subjectAltName DNS:<host>`, `extendedKeyUsage serverAuth`), Gateway 2 Jahre (`extendedKeyUsage clientAuth`). Passphrase des CA-Schlüssels: interaktiv; für Tests und Stack-Test aus `SMART_PKI_PASSPHRASE_FILE`. CRL 365 Tage, nach jeder Sperrung neu; `crl-next-update` enthält `nextUpdate` als ISO 8601 (UTC). Eine kleine `openssl ca`-Datenbank (`index.txt`, `serial`) im PKI-Verzeichnis.

```bash
# Gateway IDs are the certificate CN and the broker user name (use_identity_as_username):
# only this shape may be issued, so no certificate can ever act as smart-api or smart-simulator.
GATEWAY_ID_RE='^gw-[a-z0-9]{8}$'
new_gateway_id() {
  local id
  id="gw-$(LC_ALL=C tr -dc 'a-z0-9' < /dev/urandom | head -c 8)"
  printf '%s' "$id"
}
```

**`broker-certs.sh <staging|production>`** (Till, wie `provision.sh` mit `SMART_VPS`): kopiert `ca.crt`, `server.crt`, `server.key`, `crl.pem`, `crl-next-update` per `ssh` (stdin, `umask 077`) nach `<stack>/certs/`, setzt in der `.env` des Stacks `MQTT_TLS=on` (einzige Zeile, die das Skript ändert) und startet den Broker neu (`docker compose … restart broker`) – Weg über die vorhandene Forced-Command-Infrastruktur prüfen; passt sie nicht, wie `admin.sh` mit `ssh -t`. Schlüsselinhalt nie in argv oder Ausgabe.

**Tests (`infra/pki/test`, temporäres `SMART_PKI_DIR`):** `init-ca` zweimal → zweites Mal Abbruch; Rechte `700`/`600`; `issue-gateway` ohne ID erzeugt passendes CN, mit `smart-api`, `gw-ABCDEFGH`, `../x` → Abbruch ohne Datei; Gateway-Zertifikat verifiziert gegen die CA (`openssl verify`), EKU clientAuth; Server-Zertifikat hat SAN; `revoke` → Seriennummer in der CRL, `openssl verify -crl_check` scheitert; `crl-next-update` ist ISO und ~365 Tage in der Zukunft; `status` listet Ablaufdaten. `broker-certs.sh`: verweigert unbekannte Umgebung, gibt keinen Schlüsselinhalt aus, überträgt per stdin (Stub-SSH wie die vorhandenen Deploy-Tests). Commit `feat(infra): add the gateway PKI scripts`.

---

### Task 3: Broker mit mTLS-Listener und ACL

**Files:** `infra/broker/{mosquitto.conf,tls.conf,acl,entrypoint.sh,Dockerfile}`, `infra/broker/test/broker-test.sh` (Docker, Wegwerf-CA über `pki.sh`), `.github/workflows/ci.yml` (Job `ops` oder `stack`: `bash infra/broker/test/broker-test.sh`).

**Konfiguration:** Basis `mosquitto.conf`: `per_listener_settings true`, `persistence true`, `queue_qos0_messages false`, Listener 1883 mit `password_file` und `acl_file`. `tls.conf` (nur eingebunden, wenn aktiv): Listener 8883 mit den Werten aus den Global Constraints, `cafile`/`certfile`/`keyfile`/`crlfile` aus `/mosquitto/run/certs/`, `acl_file`. Backend-Client: `max_queued_messages 10000` (gilt global; Wert dokumentieren).

**Einstieg:**

```sh
# Certificates arrive read-only and owned by the deploy user; mosquitto reads them after dropping
# privileges, so the entrypoint copies them into a tmpfs it owns. TLS is only switched on when asked
# for and complete – a half-provisioned stack must not open a public listener.
if [ "${MQTT_TLS:-off}" = on ]; then
  for f in ca.crt server.crt server.key crl.pem; do
    [ -s "/mosquitto/certs/$f" ] || { echo "MQTT_TLS=on but /mosquitto/certs/$f is missing" >&2; exit 1; }
  done
  install -d -o mosquitto -g mosquitto -m 700 /mosquitto/run/certs
  for f in ca.crt server.crt server.key crl.pem; do
    install -o mosquitto -g mosquitto -m 600 "/mosquitto/certs/$f" /mosquitto/run/certs/
  done
  cat /mosquitto/config/tls.conf >> /mosquitto/run/mosquitto.conf
fi
```

Passwortdatei: `smart-api` (wie bisher) und `smart-simulator` (`MQTT_SIMULATOR_PASSWORD`, optional; ohne Wert kein Simulator-Benutzer). ACL wie Global Constraints plus:

```
user smart-simulator
topic write gw/${MQTT_SIMULATOR_GATEWAY_ID}/z2m/#
topic write gw/${MQTT_SIMULATOR_GATEWAY_ID}/bridge/connection
topic read  gw/${MQTT_SIMULATOR_GATEWAY_ID}/z2m/+/set
topic read  gw/${MQTT_SIMULATOR_GATEWAY_ID}/z2m/bridge/request/#
```

(Einstieg rendert die ACL mit der geprüften ID `^gw-[a-z0-9]{8}$`; ohne Simulator entfällt der Block.)

**Tests (`broker-test.sh`, Docker, Wegwerf-CA):** ohne `MQTT_TLS` kein Port 8883; `MQTT_TLS=on` mit fehlender Datei → Container beendet sich mit Meldung; Client mit gültigem Gateway-Zertifikat verbindet und publiziert `gw/<id>/z2m/x` → `smart-api` empfängt es; ohne Zertifikat, mit Zertifikat einer fremden CA und mit gesperrtem Zertifikat → Handshake scheitert; Gateway A publiziert unter `gw/<B>/z2m/x` → `smart-api` empfängt nichts (Zeitfenster 3 s); Gateway liest `gw/<id>/z2m/dev/set` (QoS 0) nur, solange verbunden – offline gesendete Befehle kommen nach dem Verbinden nicht an; Simulator-Benutzer kann nicht unter fremdem Präfix schreiben. Commit `feat(infra): accept gateways over mutual TLS`.

---

### Task 4: Compose, Provisionierung und Stack-Test mit Bridge

**Files:** `infra/compose/compose.yaml` (Broker: `./certs:/mosquitto/certs:ro`, `MQTT_TLS`, `MQTT_SIMULATOR_*`, `ports: ['${MQTT_PUBLIC_PORT:-127.0.0.1:18883}:8883']`; `api`: `./certs:/smart/certs:ro`, `GATEWAY_CA_FILE=/smart/certs/ca.crt`, `GATEWAY_CRL_NEXT_UPDATE_FILE=/smart/certs/crl-next-update`), `infra/compose/.env.example`, `infra/deploy/provision.sh` (+ Tests: legt `<stack>/certs/` mit `700` an; schreibt `MQTT_TLS=off`, Produktion zusätzlich `MQTT_PUBLIC_PORT=8883`, Staging keinen öffentlichen Port; `--force` behält vorhandene Werte, auch ein von `broker-certs.sh` gesetztes `MQTT_TLS=on`), `infra/deploy/deploy.sh` (`mkdir -p certs` vor dem Start, damit Docker den Ordner nie als root anlegt; + Test), `infra/compose/test/{compose.test.yaml,stack-test.sh}` (Wegwerf-CA über `pki.sh`, Zertifikate in ein Volume, ein Container `pi` = Mosquitto 2.1.2 mit Bridge-Konfiguration nach ADR-0020 und Gateway-Zertifikat zum Broker 8883), `infra/local/compose.yaml` (lokal ohne TLS).

**Reihenfolge im Betrieb:** Ohne Zertifikate bleibt `MQTT_TLS=off` und der Broker startet wie bisher; erst `broker-certs.sh` schaltet TLS ein. So kann kein Deploy an fehlenden Zertifikaten scheitern.

**Stack-Test (Ergänzung):** `stack-test.sh` stellt mit `pki.sh` (Wegwerf-Verzeichnis, `SMART_PKI_PASSPHRASE_FILE`) CA, Server-Zertifikat, je ein Gateway-Zertifikat für `pi` und für den Simulator aus und setzt `MQTT_TLS=on`. nach dem Start veröffentlicht `pi` lokal `zigbee2mqtt/bridge/state` → am VPS-Broker kommt `gw/<id>/z2m/bridge/state` an; `gw/<id>/bridge/connection` ist `1` (retained); `pi` gestoppt → `0`. Die Prüfung läuft als Shell-Schritt mit `mosquitto_sub` als `smart-api` im Broker-Container.

Commit `feat(infra): wire certificates and a bridged test gateway into the stacks`.

---

### Task 5: Gateways im Backend – Modell, Registrierung, Sperrung, Liste

**Files:** `apps/backend/src/core/gateways/{index.ts,gateways.module.ts,gateways.schema.ts,gateways.repository.ts,gateway-certificate.ts,gateways.controller.ts,gateways.service.ts,*.spec.ts}`, Migration (drizzle-kit), `apps/backend/src/core/households/{households.module.ts,index.ts}` (Guard und `MembershipsRepository` exportieren), `apps/backend/src/platform/config/env.schema.ts` (`GATEWAY_CA_FILE`, `GATEWAY_CRL_NEXT_UPDATE_FILE`, beide optional), `apps/backend/src/app.module.ts`, `apps/backend/test/{gateways.e2e-spec.ts,household-tenancy.e2e-spec.ts}` (Tabelle erweitern), Test-Hilfe zum Erzeugen von Wegwerf-Zertifikaten (`node:crypto` + `openssl` im Test oder feste Testzertifikate in `test/fixtures/`, die nur für Tests erzeugt wurden – öffentliche Testdaten, kein Schlüssel einer echten CA).

**Schema:** Tabelle `gateways` wie Spec 6.1 (`id` text PK mit CHECK auf das Muster, `household_id` → households `on delete cascade`, `kind` CHECK `z2m`, `bridge_status`/`z2m_status` CHECK auf die drei Werte, Standard `unknown`).

**Zertifikatsprüfung:**

```ts
/** Parses the pasted public certificate; never echoes or keeps anything but id, expiry and fingerprint. */
export function readGatewayCertificate(
  pem: string,
  ca: X509Certificate,
  now: Date,
): GatewayCertificate {
  if (/PRIVATE KEY/.test(pem))
    throw new ApiError(HttpStatus.BAD_REQUEST, 'gateway.invalidCertificate');
  const blocks = pem
    .replace(/\r\n/g, '\n')
    .match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
  // Exactly one certificate: a pasted chain would make it unclear which one is the gateway's.
  if (blocks?.length !== 1)
    throw new ApiError(HttpStatus.BAD_REQUEST, 'gateway.invalidCertificate');
  let cert: X509Certificate;
  try {
    cert = new X509Certificate(blocks[0]);
  } catch {
    throw new ApiError(HttpStatus.BAD_REQUEST, 'gateway.invalidCertificate');
  }
  const id = /(?:^|\n)CN=([^\n]+)/.exec(cert.subject)?.[1] ?? '';
  const valid =
    cert.verify(ca.publicKey) &&
    cert.checkIssued(ca) &&
    GATEWAY_ID_PATTERN.test(id) &&
    new Date(cert.validFrom) <= now &&
    new Date(cert.validTo) > now;
  if (!valid) throw new ApiError(HttpStatus.BAD_REQUEST, 'gateway.invalidCertificate');
  return { id, expiresAt: new Date(cert.validTo), fingerprint: cert.fingerprint256 };
}
```

**Endpunkte** (`v1/households/:householdId/gateways`, `HouseholdGuard`): `GET` (owner) → `gatewaySchema[]` (Warnungen aus Ablauf: Zertifikat < 30 Tage `certExpiring`, abgelaufen `certExpired`; CRL < 30 Tage `crlExpiring`); `POST` (owner + `@RequirePlatformAdmin()`; `gatewayRegisterSchema`) → `201 gatewaySchema`, ohne CA-Datei `503 gateway.caMissing`, doppelte ID `409 gateway.exists` (auch wenn sie in einem anderen Haushalt registriert ist – dann ohne Hinweis darauf, welchem); `POST …/:gatewayId/revoke` (owner + Plattform-Admin) → `204`, setzt `revoked_at`.

**Tests:** gültiges Zertifikat → angelegt mit ID, Ablauf, Fingerabdruck; Kette (zwei Zertifikate), mit privatem Schlüssel, CRLF, Leerzeilen davor/danach (gültig), abgelaufen, noch nicht gültig, fremde CA, CN `smart-api`, CN mit Großbuchstaben → `400 gateway.invalidCertificate`, nichts gespeichert, Log enthält keinen PEM-Inhalt; doppelt → `409`; ohne CA-Datei → `503`; owner ohne Plattform-Admin → `403`; member → `403`; Liste für owner, nicht für member; Sperren setzt `revoked_at`; Mandanten-Tabelle um alle Gateway-Pfade erweitert (fremder Haushalt, fremde Gateway-ID → `404`). Commit(s) `feat(backend): register gateways by certificate`.

---

### Task 6: Gateway-Status aus MQTT und Ablauf-Job

**Files:** `apps/backend/src/platform/mqtt/{mqtt.connection.ts,*.spec.ts}` (`subscribe(filter, handler)`; nach Wiederverbindung bestehen die Abonnements weiter), `apps/backend/src/core/gateways/{gateway-status.consumer.ts,gateway-expiry.job.ts,*.spec.ts}`, `apps/backend/test/gateway-status.e2e-spec.ts` (gegen den echten Test-Broker der vorhandenen Testcontainer).

**Interfaces (Produces):**

```ts
// platform/mqtt
subscribe(filter: string, handler: (topic: string, payload: Buffer, retained: boolean) => void): () => void;
```

**Verhalten:** Abonniert `gw/+/bridge/connection`, `gw/+/z2m/bridge/state`, `gw/+/z2m/#`. `bridge/connection`: `1` → `online`, `0` → `offline`, sonst ignorieren. `bridge/state`: `online`/`offline` als Text oder JSON `{"state":"…"}`. Zuordnung über die ID im Topic (muss dem Muster entsprechen, sonst verwerfen); nur nicht gesperrte, registrierte Gateways werden geschrieben (`status_changed_at` nur bei Wechsel). Jede Nachricht unter `gw/<id>/z2m/#` schreibt `last_message_at` höchstens einmal pro Minute je Gateway (Zeit aus `CLOCK`). Letzter Status jeder ID im Speicher (höchstens 1 000 IDs, älteste zuerst verworfen); `GatewaysService.register` übernimmt ihn. Unbekannte/gesperrte IDs: höchstens einmal pro Stunde je ID ein Log-Eintrag. Fehler einer Nachricht beenden den Konsumenten nie. Ereignis `gateway.status-changed` über einen kleinen internen `EventEmitter` des Moduls (Abnehmer ab Etappe 6).

**Ablauf-Job** (`@nestjs/schedule`, täglich 04:00 UTC): protokolliert Gateways mit Zertifikat < 30 Tage und eine CRL < 30 Tage (Datei `GATEWAY_CRL_NEXT_UPDATE_FILE`, fehlt sie: einmal Hinweis).

**Tests:** retained `1` vor dem Start des Konsumenten → nach dem Start `online`; `0` → `offline`; JSON- und Text-`bridge/state`; Nachricht eines unbekannten Gateways, danach Registrierung → sofort `online`; gesperrtes Gateway bleibt unverändert; `last_message_at` höchstens einmal pro Minute (Fake-Uhr); ungültige ID im Topic verworfen; Broker-Neustart (Testcontainer stoppen/starten) → neue Statusnachricht wird verarbeitet; Job findet ablaufende Zertifikate und eine ablaufende CRL. Commit(s) `feat(backend): track gateway status from the broker`.

---

### Task 7: Simulator

**Files:** `apps/gateway-simulator/{package.json,tsconfig.json,Dockerfile,src/*.ts,src/*.spec.ts,fixtures/devices.json}`, `.github/workflows/deploy.yml` (Matrix `simulator`), `infra/compose/compose.yaml` (Dienst `simulator` mit Profil `simulator`), `infra/deploy/provision.sh` (Staging: `COMPOSE_PROFILES` enthält `simulator`, `MQTT_SIMULATOR_PASSWORD`, `MQTT_SIMULATOR_GATEWAY_ID` = neu erzeugte ID nach Muster, `--force` behält sie; Produktion ohne Simulator), `infra/compose/test/stack-test.sh` (Image bauen, Profil an), `infra/local/compose.yaml` (lokal mit Simulator), `pnpm-workspace.yaml`/Lizenzprüfung falls nötig.

**Verhalten:** Konfiguration per Umgebung (`MQTT_URL`, `MQTT_USERNAME`, `MQTT_PASSWORD`, `GATEWAY_ID` nach Muster, `INTERVAL_SECONDS` Standard 300, `SEED`). Verbindet mit Last Will `gw/<id>/bridge/connection` = `0` (retained, QoS 1), setzt danach `1` (retained). Unter `gw/<id>/z2m/`: `bridge/state` `{"state":"online"}` (retained), `bridge/devices` (retained, aus `fixtures/devices.json`: sechs AOYAN AY-303Z und eine IKEA LED1624G9 mit echten Definitionen/Exposes aus Z2M, erfundene IEEE-Adressen `0x00000000000000a1` … und Namen wie „Pflanze 1“), Gerätenachrichten unter dem `friendly_name` mit `last_seen` (ISO 8601 UTC), `linkquality`, Messwerten im erlaubten Bereich; `<name>/availability` `{"state":"online"}`. Werteverlauf: Bodenfeuchte sinkt um 0,5–2 Punkte je Stunde und springt beim „Gießen“ (alle 3–5 Tage) auf 70–90; Batterie sinkt langsam; ein Sensor geht für eine Stunde am Tag offline. Die Lampe übernimmt `set`-Werte (`state`, `brightness`, `color_temp`) und meldet den neuen Zustand. Beendet sauber (setzt `0`, trennt).

**Tests:** Nachrichtenform gegen die Fixtures (Felder und Typen wie Z2M); Werte bleiben im Bereich über 30 simulierte Tage (deterministisch per `SEED`); `set` auf die Lampe → Zustandsnachricht; Last Will konfiguriert. Commit `feat(gateway): add a gateway simulator`.

---

### Task 8: Frontend – Seite „Gateways“

**Files:** `apps/frontend/src/app/features/gateways/{index.ts,gateways.routes.ts,gateways-feature.ts,gateways-page.ts,register-form.ts,i18n/{de,en}.json,*.spec.ts}`, `apps/frontend/src/app/app.routes.ts` (`mehr/gateways` vor `mehr`, `canMatch: [minRole('owner')]`), `apps/frontend/src/app/app.config.ts` (`provideGatewaysFeature()`), `apps/frontend/transloco.config.cjs`, „Kommt bald“-Eintrag „Gateways“ der „Mehr“-Seite ersetzen.

**Seite:** Liste der Gateways des aktuellen Haushalts: Name, Bridge-Status und Z2M-Status (Badge/Text), letzte Nachricht relativ, Zertifikatsablauf (Datum in Haushaltszone), Warnungen als Banner („Zertifikat läuft in N Tagen ab“, „Sperrliste läuft bald ab“). Für Plattform-Admins zusätzlich „Gateway registrieren“ (Name, Zertifikat als mehrzeiliges Textfeld; Fehlercodes übersetzt) und „Sperren“ (zweistufig, danach Hinweis auf `pki.sh revoke` und `broker-certs.sh`). Ohne Gateways: leerer Zustand mit kurzem Hinweis auf das Runbook. Muster wie `features/households` (LoadedList, Zustand an `current()?.id`, `household-errors` für 403/404). Kein `ui-card` nötig; Start-Bundle prüfen.

**Tests:** owner sieht Liste ohne Formular; Plattform-Admin sieht Formular, Registrieren sendet genau `{ name, certificate }` und zeigt das neue Gateway; `gateway.invalidCertificate`, `gateway.exists`, `gateway.caMissing` übersetzt; Sperren erst nach zweitem Druck; Warnungen sichtbar; Haushaltswechsel lädt neu; Texte de/en. Falls `ui-text-field` keinen mehrzeiligen Modus hat: `@smart/ui/forms` um eine Textarea-Variante erweitern (mit Story, Storybook-Prüfung). Commit(s) `feat(frontend): show and register gateways`.

---

### Task 9: Stack-E2E und Doku

**Files:** `tests/e2e/specs/gateways.spec.ts`, `tests/e2e/helpers/*` (Zertifikat des Test-Gateways aus dem Stack-Test-Volume lesen oder vom Skript als Datei bereitstellen), `docs/runbooks/gateway.md`, `docs/runbooks/provisioning.md` (Verweis, neue Variablen), Architektur-Spec 4.3, 4.5, 8.4, Abschnitt 14 (ADR-0020), `CLAUDE.md` (Befehle `bash infra/pki/test/run-tests.sh`, `bash infra/broker/test/broker-test.sh`), `.local/` bleibt unberührt.

**E2E:** Plattform-Admin (Konto `owner`) registriert das Gateway des `pi`-Containers mit dessen Zertifikat → Status „online“ (Bridge) erscheint; das Simulator-Gateway wird ebenso registriert → Z2M-Status „online“; ein Member sieht „Gateways“ nicht unter „Mehr“; ein ungültiges Zertifikat zeigt die übersetzte Meldung. Code-Anforderungen: keine neuen (gespeicherte Sessions nutzen; Limit 10/IP ist ausgeschöpft).

**Runbook (Deutsch):** PKI einrichten (`init-ca`, Passphrase in den Passwortmanager, Sicherung von `~/.smart-pki`), Server-Zertifikat, `broker-certs.sh` für Staging und Produktion, UFW-Regel 8883 und Fail2ban-Filter (Till, Root), Gateway ausstellen und registrieren, Simulator auf Staging registrieren, Sperren, Erneuern (Zertifikate 2 Jahre, CRL jährlich), Prüfung nach Inbetriebnahme (Schreib-/Lesetest der ACL).

Commit(s) `test(infra): cover gateways in the stack` und `docs: describe the gateway PKI and broker`.

## Ergebnis und Übertrag

Umgesetzt subagent-gestützt (Sonnet für Umsetzung und Reviews, Haiku für kleine Nachprüfungen, Opus für das Gesamt-Review mit einer Nachbesserungsrunde). Task 7 und 8 liefen parallel in getrennten Arbeitskopien; Task 8 und 9 hatten auf Tills Wunsch kein eigenes Review, nur das Gesamt-Review. Dieser Abschnitt hält fest, wo die Umsetzung vom Plan abweicht und was 5b und 6 übernehmen müssen.

### Abweichungen vom Plan (Entscheidungen)

- **Zertifikate auf dem VPS in zwei Ordnern:** `certs/public/` (CA, Server-Zertifikat, CRL, `crl-next-update`; API und Broker) und `certs/private/` (nur `server.key`; nur der Broker). Sonst hätte die API den Broker-Schlüssel lesen können, wenn der Deploy-User die UID 1000 hat.
- **PKI:** CA-Schlüssel entsteht direkt verschlüsselt (PBKDF2 600 000 Runden), die Passphrase geht nur über einen Dateideskriptor an OpenSSL; `broker-certs.sh` überträgt alles in einer SSH-Sitzung und prüft vorher, dass die CRL nicht abgelaufen ist.
- **Gateway-Zertifikate:** Das Backend nimmt nur Client-Zertifikate an (kein `CA:true`, EKU `clientAuth` Pflicht), genau ein Zertifikat, nie einen privaten Schlüssel; die Oberfläche lehnt eingefügte Schlüssel schon im Browser ab.
- **Broker-Benutzer fest `smart-api`** (kein konfigurierbarer Name, keine Kollision mit `gw-…`).
- **Port:** Produktion veröffentlicht 8883; sonst ein zufälliger Port auf `127.0.0.1`. `MQTT_TLS` bleibt `off`, bis `broker-certs.sh` es einschaltet.
- **Status:** Retained `bridge/connection` und `bridge/state`; der Status unbekannter Gateways wird gemerkt und bei der Registrierung übernommen (auch wenn er während der Registrierung eintrifft).
- **Simulator:** sechs Bodensensoren und eine Lampe aus echten Z2M-Definitionen mit erfundenen Adressen und Namen; auf Staging über das Compose-Profil `simulator`.
- **Gemeinsame Bausteine:** `LoadedList` und die Fehlerbehandlung für Haushaltspfade liegen in `core/household`.
- **`provision.sh --force`** behält auch die Backup-Angaben (Enter).

### Übertrag

- **Till, vor dem nächsten Deploy:** Umstiegsliste in `docs/runbooks/deploy.md` („Umstieg auf Etappe 5a“) abarbeiten: `provision.sh production --force`, Simulator-Paket auf GHCR öffentlich, `provision.sh staging --force`, `broker-certs.sh`, ufw/fail2ban, Simulator auf Staging registrieren.
- **5b:** Verhalten von retained `bridge/connection` nach einem sauberen Broker-Neustart am echten Aufbau prüfen; QoS-Option des echten Z2M; gemischte Queue über 24 h auf 2.1.x.
- **6:** `last_message_at` muss `…/set` und `…/bridge/request/#` ignorieren, sobald Befehle gesendet werden; Erneuern eines Gateway-Zertifikats mit gleicher ID fehlt (vor Ablauf in 2 Jahren lösen).
- **Bundle:** initial rund 471 kB von 480 kB.

### Bewusst zurückgestellt (klein)

- PKI/Skripte: `mv`-Reihenfolge beim Tausch (Zertifikat vor Schlüssel), `tar` ohne `-h`, Ausgaben auf Englisch, kein Broker-Test für abgelaufenes Zertifikat und abgelaufene CRL, Stack-Test prüft die Mount-Fixtures statt `compose.yaml`.
- Backend: Statusereignis bei spät übernommenem Status fehlt; überlappende Abos liefern doppelt (idempotent); Cron-Registrierung ungetestet; täglicher Hinweis bei fehlendem CRL-Datum.
- Simulator: schwacher Test der Austrocknungsrate, Offline-Fenster hängt vom Intervall ab, `infra:up --build` baut oft neu, kein Healthcheck.
- Fail2ban-Filter am VPS ungetestet; mögliche Instabilität eines Offline-Banner-E2E unter Last; Mandanten-Tabelle prüft nur Plattform-Admins als owner.
