# Selbst-Kopplung von Home Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein Eigentümer koppelt sein Home Assistant per Kopplungscode aus der App – ohne Zertifikate und ohne Till –, das HA verbindet sich mit Benutzer und abgeleitetem Schlüssel per WebSocket über 443 mit dem Broker, und Sperren trennt sofort.

**Architecture:** Broker bekommt einen internen WebSocket-Listener mit dem Plugin Dynamic Security (Zustand nur im tmpfs); das Backend ist Quelle der Wahrheit (Tabelle `gateway_pairings`, Zugangsart `credentials` an `gateways`), leitet Schlüssel per HMAC ab und gleicht die Broker-Benutzer über `$CONTROL/dynamic-security/v1` ab. Die HA-Integration bekommt einen Config Flow mit Reauth und verbindet sich über `wss://<app>/mqtt` (Web-Nginx → Broker). Verteilung über ein HACS-Spiegel-Repository; auf dem Pi wird HA per `--ha on|off` geschaltet.

**Tech Stack:** Mosquitto 2.1.2 (`mosquitto_dynamic_security.so`), NestJS 12.5, Drizzle 0.45, zod/mini, mqtt.js, Vitest + Testcontainers; Angular 22 (`@smart/ui`); Home Assistant 2026.11.0 (Python 3.14, paho-mqtt 2.1.0, aiohttp), pytest-homeassistant-custom-component 0.13.375, ruff; Bash-Testsuiten mit Docker; Playwright (Stack-Test); GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-20-ha-kopplung-design.md`

## Global Constraints

- Code, Bezeichner, Kommentare, Commits: Englisch; Doku in `docs/`: Deutsch. Conventional Commits mit Scope aus: repo, frontend, backend, contracts, ui, lint, infra, gateway, ci, docs, deps (Integration: `gateway`; Broker, Compose, Web-Nginx: `infra`).
- Keine KI-Attribution in Commits (commitlint blockiert `Co-Authored-By: Claude` und „Generated with …“).
- Öffentliches Repo: keine IPs, privaten Hostnamen, E-Mail-Adressen, Secrets. Vor jedem Push: `git grep -nE -f .local/private-patterns.txt -- .` (leer). In Beispielen nur `smart.example.org`.
- Lint-Regeln nie abschalten; passt eine Regel nicht, wird sie in `tools/lint-config` mit Test angepasst. In Python kein `# noqa` ohne Begründung im selben Kommentar.
- **Passwörter, Kopplungscodes und Nutzlasten werden nie geloggt** (Backend, Broker-Steuerung, Integration). Codes nur als SHA-256 in der Datenbank.
- Der WebSocket-Listener `8080` wird nie veröffentlicht (nur internes Docker-Netz bzw. lokal `127.0.0.1`). Listener 1883 und 8883 bleiben in Verhalten und Konfiguration unverändert, ebenso die Z2M-Bridge auf dem Pi.
- Dynamic-Security-Zustand nur in `/mosquitto/run` (tmpfs), nie auf dem Daten-Volume. Gemessen (Mosquitto 2.1.2): `setClientPassword` trennt bestehende Verbindungen **immer**, auch bei gleichem Passwort; `createRole`/`createClient` auf Vorhandenes antworten mit `"error":"Role already exists"` bzw. `"Client already exists"`; `deleteClient` trennt sofort; eine an den Benutzer gebundene `clientid` weist andere Client-IDs mit „not authorised“ ab; `smart-api` kann die Steuer-Topics über 1883 nutzen, wenn die ACL-Datei es erlaubt.
- Konstanten (Spec): Code 8 Zeichen Crockford-Base32 (`0123456789ABCDEFGHJKMNPQRSTVWXYZ`), Anzeige `XXXX-XXXX`, gültig 15 min; höchstens 5 nicht gesperrte `credentials`-Gateways je Haushalt; Rate-Limits `gatewayPairingCreatePerIp` 20/15 min, `gatewayPairingRedeemPerIp` 10/15 min; Abgleich alle 10 min und nach jedem Verbindungsaufbau; Zeitlimit Steuerbefehl 5 s; Client-ID `<gatewayId>-ha`; Rolle `smart-gateway-ha`; `textdescription` `generation:<n>`; `max_connections 500` am WebSocket-Listener; Aufräumen eingelöster/abgelaufener Codes nach 7 Tagen; Offline-Hinweis nach 7 Tagen.
- Zeit: speichern/übertragen nur UTC (`…Z`); Backend-Tests laufen zusätzlich mit `TZ=Pacific/Chatham` (`pnpm test:tz`).
- Initiales Frontend-Bundle ≤ 425 kB (Stand rund 415,40 kB); alles Neue gehört zur lazy Gateway-Seite.
- Gepinnt: `eclipse-mosquitto:2.1.2-alpine`, HA-Image `ghcr.io/home-assistant/home-assistant:2026.11.0`, `paho-mqtt==2.1.0`, Testwerkzeuge der Integration wie in `requirements-test.txt`.
- Prüfen vor dem Abschluss jedes Tasks: die im Task genannten Tests; bei Änderungen im Node-Teil zusätzlich `pnpm lint && pnpm typecheck` im Repo-Wurzelverzeichnis. Backend-Tests brauchen Docker und OpenSSL ≥ 3.

## Review Focus

1. **Abgleich bei laufenden HA-Verbindungen:** Ein Abgleich ohne Änderung darf keine Verbindung trennen (ein `setClientPassword` würde es tun). Erwartet: verbundener Client bleibt verbunden über zwei Abgleiche (Task 4).
2. **Broker startet neu, Backend-Sitzung bleibt:** Der Broker verliert alle Benutzer (tmpfs). Erwartet: das Backend gleicht nach seinem Wiederverbinden ab, HA kommt innerhalb seiner Wiederverbindung (≤ 60 s) wieder hinein (Task 4, E2E mit Broker-Neustart).
3. **Doppeltes Einlösen:** HA schickt denselben Code zweimal fast gleichzeitig (Doppelklick, Wiederholung nach Zeitüberschreitung). Erwartet: genau ein Gateway, die zweite Antwort 404 `gateway.pairingInvalid` (Task 5).
4. **Code abgetippt:** Kleinbuchstaben, mit/ohne Bindestrich, Leerzeichen, `O` statt `0`, `I`/`L` statt `1`. Erwartet: wird angenommen (Task 5, Normalisierung).
5. **Reauth mit falschem Code:** In HA wird beim Erneut-Authentifizieren ein Code für ein neues Gateway eingegeben. Erwartet: 409 `gateway.pairingOtherGateway`, Code bleibt gültig, HA zeigt den erklärenden Fehler (Task 5, Task 7).

---

## Dateistruktur

| Datei                                                                                              | Verantwortung                                                                                                           |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `infra/broker/mosquitto.conf`, `entrypoint.sh`, `acl`, `test/broker-test.sh`                       | WebSocket-Listener 8080 mit Dynamic Security, leere Konfiguration im tmpfs, Steuerrecht `smart-api`                     |
| `infra/local/compose.yaml`, `apps/frontend/proxy.conf.json`                                        | lokal `127.0.0.1:8084` → 8080, `ng serve` leitet `/mqtt` weiter                                                         |
| `apps/backend/src/platform/mqtt/mqtt.connection.ts`                                                | `publish()`, `onConnect()`                                                                                              |
| `packages/contracts/src/gateways.ts`, `gateway-pairing.ts` (neu)                                   | `auth`, `certExpiresAt` nullable, Kopplungs-Schemas                                                                     |
| `apps/backend/drizzle/0013_gateway_pairing.sql` (+ Snapshot/Journal)                               | Spalten an `gateways`, Tabelle `gateway_pairings`                                                                       |
| `apps/backend/src/core/gateways/credentials/` (neu)                                                | `password.ts`, `dynsec.ts` (Steuer-Client), `reconcile-plan.ts`, `gateway-credentials.service.ts`                       |
| `apps/backend/src/core/gateways/pairing/` (neu)                                                    | `pairing-code.ts`, `gateway-pairings.repository.ts`, `pairing.service.ts`, Controller, Aufräum-Job                      |
| `apps/backend/src/platform/http/skip-origin-check.decorator.ts` (neu), `origin.guard.ts`           | Ausnahme von der Origin-Prüfung                                                                                         |
| `apps/frontend/src/app/features/gateways/`                                                         | Kopplungs-Abschnitt, Einträge für `credentials`, Formular nur Z2M                                                       |
| `integrations/home-assistant/custom_components/smart_bridge/`                                      | `config_flow.py` (neu), `pairing.py` (neu), `connection.py` (WebSocket), `__init__.py` (Entry), Manifest, Übersetzungen |
| `integrations/home-assistant/test/`                                                                | Phase 2 mit vorab angelegtem Config Entry                                                                               |
| `apps/frontend/nginx/default.conf`, `infra/compose/compose.yaml`, `infra/deploy/provision.sh`      | `/mqtt`, Alias `smart-broker-upstream`, `GATEWAY_CREDENTIAL_SECRET`                                                     |
| `tests/e2e/specs/ha-pairing.spec.ts` (neu), `infra/compose/test/stack-test.sh`                     | Durchstich durch Web-Nginx                                                                                              |
| `gateway/deploy.sh`, `gateway/compose.yaml`, `gateway/homeassistant/configuration.yaml`            | `--ha on                                                                                                                | off`, ohne HA-Secrets |
| `infra/deploy/provision-ha.sh`                                                                     | entfällt                                                                                                                |
| `integrations/home-assistant/release/` (neu), `.github/workflows/ha-integration-release.yml` (neu) | HACS-Spiegel und Release                                                                                                |

---

### Task 1: Broker – WebSocket-Listener mit Dynamic Security

**Files:**

- Modify: `infra/broker/mosquitto.conf`, `infra/broker/entrypoint.sh`, `infra/broker/acl`
- Modify: `infra/broker/test/broker-test.sh`
- Modify: `apps/backend/test/helpers/test-broker.ts` (Port 8080 zusätzlich freigeben: `withExposedPorts(1883-Variante, 8080)`)
- Modify: `infra/local/compose.yaml` (Broker: `127.0.0.1:8084:8080`), `apps/frontend/proxy.conf.json` (`/mqtt` → `http://127.0.0.1:8084`, `ws: true`)

**Interfaces:**

- Produces: Listener `8080` (`protocol websockets`) mit Dynamic Security; Konfigurationsdatei `/mosquitto/run/dynsec.json`; `smart-api` darf `$CONTROL/dynamic-security/#` lesen und schreiben. Testbroker der Backend-E2E bietet 8080.

- [ ] **Step 1: Failing tests im Broker-Test** (`broker-test.sh`, Abschnitt ohne TLS). Mit `mosquitto_rr` als `smart-api` über 1883 an `$CONTROL/dynamic-security/v1`:
  - `createRole` `smart-gateway-ha` (Regeln `publishClientSend` `gw/%u/ha/#`, `gw/%u/bridge/connection`) und `createClient` `gw-…` mit Passwort, `clientid` `<id>-ha`, Rolle → Antwort ohne `error`.
  - Über `ws://broker:8080/` (mosquitto_pub `-L`, `-i <id>-ha`): eigenes Präfix kommt bei `smart-api` an; fremdes Präfix nicht; falsches Passwort → Exit-Code 5; andere Client-ID (`-i smart-api-x`) → Exit-Code 5; ohne Anmeldung → abgewiesen.
  - Standard verboten: der Client darf `gw/<id>/ha/x` nicht abonnieren (SUBACK-Fehler; z. B. `mosquitto_sub … -C 1 -W 3` endet ohne Nachricht, obwohl `smart-api` dorthin veröffentlicht).
  - Ein Gateway-Client kann über 8080 nichts an `$CONTROL/…` steuern (danach existiert sein Benutzer noch: `listClients`).
  - Ein Neustart des Broker-Containers leert die Benutzer (`listClients` enthält den Benutzer nicht mehr).
  - Positivkontrolle zu jedem „kommt nicht an“: dieselbe Abfrage mit erlaubtem Topic kommt an.
- [ ] **Step 2: Laufen lassen, Fehlschlag sehen.** `bash infra/broker/test/broker-test.sh` → FAIL (kein Listener 8080).
- [ ] **Step 3: Umsetzen.**
  - `mosquitto.conf` am Ende:
    ```
    # Gateways paired from the app (Home Assistant): websockets behind the web nginx (/mqtt), user name and
    # key from the backend through the dynamic security plugin. Never published; the state lives in the tmpfs
    # and the backend recreates it after every start (docs/superpowers/specs/2026-11-20-ha-kopplung-design.md).
    listener 8080
    protocol websockets
    allow_anonymous false
    max_connections 500
    plugin /usr/lib/mosquitto_dynamic_security.so
    plugin_opt_config_file /mosquitto/run/dynsec.json
    ```
  - `entrypoint.sh` vor `secure`: schreibt `"$RUN/dynsec.json"` mit `{"defaultACLAccess":{"publishClientSend":false,"publishClientReceive":false,"subscribe":false,"unsubscribe":true},"clients":[],"groups":[],"roles":[]}` und nimmt die Datei in `secure` auf (das Plugin schreibt sie bei Änderungen neu; der Ordner gehört dem Broker-Benutzer – prüfen, dass `$RUN` ihm gehört oder beschreibbar ist, sonst `chown mosquitto:mosquitto "$RUN"`).
  - `acl` unter `user smart-api`: `topic readwrite $CONTROL/dynamic-security/#` mit Kommentar (steuert die Benutzer des WebSocket-Listeners).
  - Testbroker-Helfer und lokale Compose wie unter Files.
- [ ] **Step 4: Tests grün.** `bash infra/broker/test/broker-test.sh`; `pnpm infra:up && pnpm infra:test && pnpm infra:down`; `pnpm --filter @smart/backend test -- mqtt` (unverändert grün).
- [ ] **Step 5: Commit.** `feat(infra): websocket listener with dynamic security for paired gateways`

---

### Task 2: Plattform-MQTT – `publish()` und `onConnect()`

**Files:**

- Modify: `apps/backend/src/platform/mqtt/mqtt.connection.ts`
- Test: `apps/backend/src/platform/mqtt/mqtt.connection.spec.ts`, `apps/backend/test/mqtt.e2e-spec.ts`

**Interfaces:**

- Produces:

  ```ts
  /** Publishes; resolves once the broker acknowledged (QoS 1) or the packet left (QoS 0). Rejects while disconnected. */
  publish(topic: string, payload: string | Buffer, options?: { qos?: 0 | 1; retain?: boolean }): Promise<void>;
  /** Calls the listener after every (re)connect, also when the session was kept; returns a function that removes it. A throwing listener is reported through onError, never breaks the connection. */
  onConnect(listener: () => void): () => void;
  ```

- [ ] **Step 1: Failing tests.** Unit (mit dem vorhandenen Muster der Spec, gefälschter Client): `publish` reicht Topic/Nutzlast/QoS (Standard 1, `retain` false) durch und lehnt ab, wenn nicht verbunden (`Error('mqtt.notConnected')`); `onConnect`-Listener wird bei jedem `connect` gerufen, auch mit `sessionPresent`, Rückgabefunktion entfernt ihn, ein werfender Listener landet in `onError`. E2E (`mqtt.e2e-spec.ts`): zwei Verbindungen am Testbroker, eine veröffentlicht, die andere empfängt; nach Neustart des Brokers wird `onConnect` erneut gerufen.
- [ ] **Step 2: Fehlschlag sehen.** `pnpm --filter @smart/backend test -- mqtt`.
- [ ] **Step 3: Umsetzen** mit `this.client.publish(topic, payload, { qos, retain }, (error) => …)` als Promise; `onConnect` über ein `Set<() => void>`, im bestehenden `connect`-Handler nach dem Resubscribe aufrufen (je Listener `try/catch` → `this.onError`).
- [ ] **Step 4: Grün.** Dieselben Tests, `pnpm lint && pnpm typecheck`.
- [ ] **Step 5: Commit.** `feat(backend): publish and connect notifications on the mqtt connection`

---

### Task 3: Contracts, Migration 0013, Zugangsart im Gateway-Kern

**Files:**

- Modify: `packages/contracts/src/gateways.ts`; Create: `packages/contracts/src/gateway-pairing.ts` (+ Export im Index, Spec)
- Modify: `apps/backend/src/core/gateways/gateways.schema.ts`; Create: `apps/backend/src/core/gateways/pairing/gateway-pairings.schema.ts` (Tabelle; im Drizzle-Schema-Index registrieren wie die anderen Tabellen)
- Create: `apps/backend/drizzle/0013_gateway_pairing.sql` + Snapshot + Journal; `apps/backend/test/database.e2e-spec.ts` erwartet 14 Migrationen
- Modify: `apps/backend/src/platform/config/env.schema.ts` (+ Spec): `GATEWAY_CREDENTIAL_SECRET` optional, mindestens 32 Zeichen
- Modify: `apps/backend/src/core/gateways/gateways.service.ts`, `gateways.controller.ts`, `gateway-expiry.job.ts`, `gateways.repository.ts` (+ Specs, `apps/backend/test/gateways.e2e-spec.ts`)
- Modify (nur damit Typen stimmen): `apps/frontend/src/app/features/gateways/gateways-page.ts` (Zertifikatsablauf nur, wenn `certExpiresAt` gesetzt)

**Interfaces:**

- Produces (Contracts):
  ```ts
  export const GATEWAY_AUTHS = ['certificate', 'credentials'] as const;
  export type GatewayAuth = (typeof GATEWAY_AUTHS)[number];
  // gatewaySchema: + auth: z.enum(GATEWAY_AUTHS); certExpiresAt: z.nullable(z.string())
  // gateway-pairing.ts
  export const PAIRING_CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;
  export const gatewayPairingCreateSchema = z.object({ gatewayId: z.optional(gatewayIdSchema) });
  export const gatewayPairingSchema = z.object({
    code: z.string(),
    expiresAt: z.string(),
    appUrl: z.string(),
  });
  export const gatewayPairingRedeemSchema = z.object({
    code: z.string().check(z.minLength(1), z.maxLength(32)),
    name: z.optional(displayNameSchema),
    expectedGatewayId: z.optional(gatewayIdSchema),
  });
  export const gatewayPairingRedeemedSchema = z.object({
    gatewayId: gatewayIdSchema,
    mqttUrl: z.string(),
    username: z.string(),
    password: z.string(),
    clientId: z.string(),
  });
  // + Typen GatewayPairingCreate, GatewayPairing, GatewayPairingRedeem, GatewayPairingRedeemed
  ```
- Produces (DB): `gateways.auth` (`'certificate' | 'credentials'`, Standard `certificate`), `gateways.credentialGeneration` (`number | null`), `certFingerprint`/`certExpiresAt` nullable; Check `gateways_auth_check` wie Spec 5.1. Tabelle `gateway_pairings` (Spalten Spec 5.1; Drizzle-Namen `id, householdId, gatewayId, codeHash, createdBy, createdAt, expiresAt, usedAt`; Index auf `household_id`).
- Produces (Kern): `GatewaysService.revoke(householdId, id, actor: { platformAdmin: boolean })`; Rechte: `credentials` → Rolle owner genügt, `certificate` → `platformAdmin` nötig, sonst `ApiError(403, 'auth.forbidden')`. Controller `revoke` verliert `@RequirePlatformAdmin()` und reicht `platformAdmin` des aktuellen Benutzers durch (so wie andere Stellen den Admin-Status lesen). `register` (Zertifikat) lehnt `kind: 'ha'` mit 400 `validation.failed` ab. `toGateway` liefert `auth`; Warnungen nur für `certificate`. `GatewaysService.crlNextUpdate()` wird für die Seitenwarnung nur relevant, wenn ein `certificate`-Gateway existiert (Liste: nur dann laden). Der Ablauf-Job überspringt Zeilen ohne `certExpiresAt`. Ereignis `GATEWAY_REVOKED` wie bisher.
- Produces (Env): `env.GATEWAY_CREDENTIAL_SECRET: string | undefined`.

- [ ] **Step 1: Failing tests.**
  - Contracts-Spec: `gatewaySchema` mit `auth: 'credentials'` und `certExpiresAt: null` gültig; `gatewayPairingRedeemSchema` lehnt leeren Code ab; `PAIRING_CODE_PATTERN` passt auf `K7QM-4XWP`, nicht auf `K7QM4XWP` oder `I7QM-4XWP`.
  - Env-Spec: Geheimnis mit 31 Zeichen → Fehler nennt `GATEWAY_CREDENTIAL_SECRET`; fehlt → `undefined`.
  - Backend-E2E `gateways.e2e-spec.ts`: Registrierung per Zertifikat mit `kind: 'ha'` → 400; bestehende Z2M-Registrierung → `auth: 'certificate'`; eine direkt in die DB geschriebene `credentials`-Zeile (Helfer im Test) erscheint mit `certExpiresAt: null`, `warnings: []`; Eigentümer ohne Plattform-Admin sperrt `credentials`-Gateway → 204, `certificate`-Gateway → 403; DB weist `auth = 'credentials'` mit `kind = 'z2m'` ab (Check) und `credentials` ohne Generation.
  - Ablauf-Job-Spec: Zeile ohne `certExpiresAt` erzeugt keine Warnung.
- [ ] **Step 2: Fehlschlag sehen.** `pnpm --filter @smart/contracts test`, `pnpm --filter @smart/backend test -- gateways env.schema gateway-expiry`.
- [ ] **Step 3: Umsetzen.** Contracts; `pnpm packages:build`. Schema ändern, Migration mit `pnpm --filter @smart/backend exec drizzle-kit generate --name gateway_pairing` erzeugen, SQL lesen (Check `gateways_auth_check` und Tabelle vorhanden), zweites `generate` → „No schema changes“. Service, Controller, Job, Repository; Frontend-Stelle minimal (`@if (gateway.certExpiresAt)`).
- [ ] **Step 4: Grün.** Dieselben Tests, `pnpm --filter @smart/frontend test -- gateways`, `pnpm lint && pnpm typecheck`.
- [ ] **Step 5: Commit.** `feat(contracts): gateway access kinds and pairing schemas` und `feat(backend): credentials gateways in the gateway core`

---

### Task 4: Zugangsschlüssel und Broker-Abgleich

**Files:**

- Create: `apps/backend/src/core/gateways/credentials/password.ts` (+ Spec)
- Create: `apps/backend/src/core/gateways/credentials/dynsec.ts` (+ Spec)
- Create: `apps/backend/src/core/gateways/credentials/reconcile-plan.ts` (+ Spec)
- Create: `apps/backend/src/core/gateways/credentials/gateway-credentials.service.ts` (+ Spec), Registrierung in `gateways.module.ts`
- Test: `apps/backend/test/gateway-credentials.e2e-spec.ts` (neu)

**Interfaces:**

- Consumes: `MqttConnection.publish`, `.subscribe`, `.onConnect` (Task 2); `env.GATEWAY_CREDENTIAL_SECRET`, `gateways.auth`, `gateways.credentialGeneration` (Task 3); `GatewaysRepository` (neue Methode `listActiveCredentials(): Promise<{ id: string; generation: number }[]>`).
- Produces:

  ```ts
  // password.ts
  export function deriveGatewayPassword(
    secret: string,
    gatewayId: string,
    generation: number,
  ): string {
    return createHmac('sha256', secret)
      .update(`smart-gateway-credential\0${gatewayId}\0${generation}`)
      .digest('base64url');
  }
  export const gatewayClientId = (gatewayId: string): string => `${gatewayId}-ha`;
  export const generationTag = (generation: number): string => `generation:${generation}`;

  // reconcile-plan.ts
  export interface BrokerClient {
    username: string;
    textdescription?: string;
  }
  export interface WantedClient {
    id: string;
    generation: number;
  }
  export type ClientStep =
    | { kind: 'create'; id: string; generation: number }
    | { kind: 'rekey'; id: string; generation: number }
    | { kind: 'delete'; username: string };
  /** Only differences: an unchanged client gets no step (a password reset would disconnect it). */
  export function planReconcile(
    wanted: readonly WantedClient[],
    actual: readonly BrokerClient[],
  ): ClientStep[];

  // dynsec.ts
  export class DynsecError extends Error {}
  /** One command at a time over $CONTROL/dynamic-security/v1; responses matched by correlationData; 5 s timeout. */
  export class DynsecClient {
    constructor(mqtt: MqttConnection);
    send(command: Record<string, unknown>): Promise<Record<string, unknown> | undefined>; // rejects DynsecError(response.error | 'timeout')
  }

  // gateway-credentials.service.ts
  export class GatewayCredentials {
    /** Available when the secret is configured. */
    readonly enabled: boolean;
    password(gatewayId: string, generation: number): string;
    create(gatewayId: string, generation: number): Promise<void>; // createClient(..., textdescription, roles)
    rekey(gatewayId: string, generation: number): Promise<void>; // setClientPassword (disconnects) + modifyClient textdescription
    remove(gatewayId: string): Promise<void>; // deleteClient; "Client not found" counts as success
    reconcile(): Promise<void>; // Spec 5.4 steps 1–3
  }
  ```

- [ ] **Step 1: Failing unit tests.**
  - `password.spec.ts`: fester Testvektor (Geheimnis `'x'.repeat(32)`, `gw-abcdefgh`, 1 → Wert im Test aus Node `createHmac` einmal berechnet und als Literal eingetragen); andere Generation → anderer Wert; Länge 43; nur `[A-Za-z0-9_-]`.
  - `reconcile-plan.spec.ts`: fehlend → `create`; vorhanden mit gleicher Generation → **kein Schritt**; abweichende/fehlende `textdescription` → `rekey`; überzähliger Benutzer → `delete`; leere Listen → `[]`; Reihenfolge stabil (nach ID).
  - `dynsec.spec.ts` (gefälschte MQTT-Verbindung): sendet `{"commands":[{…, "correlationData": "<n>"}]}` an `$CONTROL/dynamic-security/v1`; ordnet Antwort mit passender `correlationData` zu; fremde Antworten ignoriert; `error` → `DynsecError(error)`; nach 5 s → `DynsecError('timeout')` (Fake-Timer); zweiter Befehl wartet auf den ersten.
  - `gateway-credentials.service.spec.ts`: ohne Geheimnis `enabled` false, `reconcile()` tut nichts und warnt höchstens einmal pro Stunde; `create` schickt `createClient` mit `clientid`, `textdescription`, Rolle; `remove` toleriert „Client not found“; `reconcile` schickt `setDefaultACLAccess`, `createRole` (toleriert „Role already exists“), `modifyRole`, `listClients` mit `verbose: true` und dann genau die Schritte aus `planReconcile`; Fehler eines Schritts bricht die anderen nicht ab (geloggt ohne Passwort); `reconcile` läuft bei `onConnect` und alle 10 min (Fake-Timer), nie zweimal gleichzeitig.
- [ ] **Step 2: Fehlschlag sehen.** `pnpm --filter @smart/backend test -- credentials`.
- [ ] **Step 3: Umsetzen.** Antworten über `mqtt.subscribe('$CONTROL/dynamic-security/v1/response', …)` (QoS 1, einmal beim Start); JSON der Antwort: `{"responses":[{"command":…,"error"?:…,"data"?:…,"correlationData"?:…}]}`. Das Ergebnis von `listClients` mit `verbose: true` liefert Objekte mit `username` und `textdescription`; vor Gebrauch im E2E-Test die tatsächliche Form prüfen und im Code den Pfad dokumentieren. Intervall über `setInterval` mit `unref()`, beim Herunterfahren beenden (`OnModuleDestroy`).
- [ ] **Step 4: Failing E2E** (`gateway-credentials.e2e-spec.ts`, echter Testbroker, Geheimnis gesetzt, Gateways per DB-Helfer):
  - nach `reconcile()` verbindet sich ein Client über `ws://<host>:<8080>/` mit `gw-…`/abgeleitetem Schlüssel/`<id>-ha` und veröffentlicht unter dem eigenen Präfix (das Backend empfängt es);
  - **zweiter `reconcile()` trennt den verbundenen Client nicht** (Client-`close`-Ereignis bleibt aus über 2 s);
  - `rekey` → alter Schlüssel abgewiesen, verbundener Client getrennt, neuer Schlüssel geht;
  - gesperrtes Gateway (DB `revoked_at`) → nach `reconcile()` getrennt und abgewiesen;
  - Haushalt gelöscht (Kaskade) → nach `reconcile()` Benutzer weg;
  - Broker-Neustart (Container `restart`, fester Host-Port wie in `mqtt-session.e2e-spec.ts`) → Backend verbindet neu, gleicht ab, Client kommt wieder hinein.
- [ ] **Step 5: Grün.** `pnpm --filter @smart/backend test -- credentials gateway-credentials`, `pnpm test:tz` (Backend), `pnpm lint && pnpm typecheck`.
- [ ] **Step 6: Commit.** `feat(backend): derive gateway keys and reconcile them with the broker`

---

### Task 5: Kopplung – Codes, Einlösen, API

**Files:**

- Create: `apps/backend/src/core/gateways/pairing/pairing-code.ts` (+ Spec)
- Create: `apps/backend/src/core/gateways/pairing/gateway-pairings.repository.ts`
- Create: `apps/backend/src/core/gateways/pairing/pairing.service.ts` (+ Spec)
- Create: `apps/backend/src/core/gateways/pairing/pairing.controller.ts` (zwei Controller: Haushalt und öffentlich), `pairing-cleanup.job.ts` (+ Spec)
- Create: `apps/backend/src/platform/http/skip-origin-check.decorator.ts`; Modify: `origin.guard.ts` (+ Spec), `throttle.ts` (`gatewayPairingCreatePerIp: { limit: 20, ttl: 15 * MINUTE_MS }`, `gatewayPairingRedeemPerIp: { limit: 10, ttl: 15 * MINUTE_MS }`), Export im Plattform-Index
- Modify: `apps/backend/src/core/gateways/gateways.module.ts`, `gateways.repository.ts` (Einfügen mit `auth = 'credentials'`, Generation erhöhen, Zählen je Haushalt)
- Test: `apps/backend/test/ha-pairing.e2e-spec.ts` (neu)

**Interfaces:**

- Consumes: `GatewayCredentials` (Task 4), Contracts (Task 3), `GATEWAY_REGISTERED` (bestehend).
- Produces:
  ```ts
  // pairing-code.ts
  export const PAIRING_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  export function newPairingCode(): string; // 8 chars via crypto.randomInt, formatted XXXX-XXXX
  /** Upper case, without blanks and dashes, O→0, I/L→1; undefined unless 8 alphabet characters remain. */
  export function normalizePairingCode(input: string): string | undefined;
  export const hashPairingCode = (normalized: string): string => createHash('sha256').update(normalized).digest('hex');
  export function newGatewayId(): string; // 'gw-' + 8 chars [a-z0-9] via crypto.randomInt
  // pairing.service.ts
  export const PAIRING_TTL_MS = 15 * 60_000;
  export const MAX_PAIRED_GATEWAYS = 5;
  create(householdId: string, userId: string, input: GatewayPairingCreate): Promise<GatewayPairing>;
  redeem(input: GatewayPairingRedeem): Promise<GatewayPairingRedeemed>;
  ```
- Routen: `POST /api/v1/households/:householdId/gateway-pairings` (HouseholdGuard, `@RequireRole('owner')`, `@RateLimit('gatewayPairingCreatePerIp')`, 201); `POST /api/v1/gateway-pairing/redeem` (`@Public()`, `@SkipOriginCheck()`, `@RateLimit('gatewayPairingRedeemPerIp')`, `@HttpCode(200)`, Header `Cache-Control: no-store`). Fehler wie Spec 5.2 (`gateway.pairingInvalid` 404, `gateway.pairingOtherGateway` 409, `gateway.limitReached` 409, `gateway.pairingUnavailable` 503, `household.notFound` 404).

- [ ] **Step 1: Failing unit tests.**
  - `pairing-code.spec.ts`: Format `XXXX-XXXX` aus dem Alphabet (1000 Stichproben); Normalisierung: `'k7qm-4xwp'`, `' K7QM 4XWP '`, `'K7QM4XWP'` → `'K7QM4XWP'`; `'O0IL-1234'` → `'00111234'`; `'K7QM-4XW'` → `undefined`; `'K7QM-4XWU'` (U nicht im Alphabet) → `undefined`; `newGatewayId()` passt auf `GATEWAY_ID_PATTERN`.
  - `skip-origin-check`: OriginGuard lässt POST ohne `Origin` auf einem Handler mit `@SkipOriginCheck()` durch, auf anderen nicht (bestehende Spec erweitern).
  - `pairing.service.spec.ts` (Repository und Credentials als einfache Fakes): `create` entwertet offene Codes desselben Ziels; `create` mit fremdem/gesperrtem/Zertifikats-Gateway → 404; Grenze 5 → 409; `redeem` neuer Code → Gateway `kind 'ha'`, `auth 'credentials'`, Generation 1, Name aus `name` oder `'Home Assistant'`, `topicPrefix` `gw/<id>/ha`, `credentials.create` gerufen, `GATEWAY_REGISTERED` gesendet, Antwort mit `mqttUrl` aus `APP_ORIGIN` (`https://smart.example.org` → `wss://smart.example.org/mqtt`, `http://localhost:4200` → `ws://localhost:4200/mqtt`); Code an Gateway → Generation +1, `credentials.rekey`; `expectedGatewayId` passt nicht → 409, Code unverbraucht; abgelaufen/benutzt/unbekannt/nicht normalisierbar → 404 gleich; Credentials werfen → 503 und nichts gespeichert; ohne Geheimnis → 503.
  - `pairing-cleanup.job.spec.ts`: löscht eingelöste/abgelaufene Zeilen älter als 7 Tage, sonst nichts.
- [ ] **Step 2: Fehlschlag sehen.** `pnpm --filter @smart/backend test -- pairing origin`.
- [ ] **Step 3: Umsetzen.** `redeem` in einer DB-Transaktion: Code-Zeile per `SELECT … FOR UPDATE` (Hash, nicht eingelöst, `expires_at > now`), Ziel prüfen, Gateway anlegen (bei ID-Kollision neue ID, höchstens 5 Versuche) bzw. Generation erhöhen, Grenze erneut prüfen, `used_at` setzen, **dann** Broker-Schritt (`create`/`rekey`) innerhalb der Transaktion; wirft er, Rollback und 503. Schlägt das Commit danach fehl, heilt der Abgleich (Generation in DB alt, am Broker neu → `rekey` auf die alte). Name beim Einlösen über `displayNameSchema`. Aufräum-Job nach dem Muster vorhandener Jobs (täglich). `GatewaysService.revoke` ruft nach dem Sperren eines `credentials`-Gateways `GatewayCredentials.remove(id)` (Fehler werden geloggt, nicht geworfen: der Abgleich holt das Löschen nach); Unit-Test dafür in `gateways.service.spec.ts`.
- [ ] **Step 4: Failing E2E** (`ha-pairing.e2e-spec.ts`, echte DB und echter Testbroker, Geheimnis gesetzt):
  - Eigentümer (kein Plattform-Admin) erzeugt Code → 201; Mitglied ohne Eigentümerrolle → 403.
  - Einlösen ohne `Origin`-Header → 200, `Cache-Control: no-store`; Client verbindet sich über WebSocket mit der Antwort, veröffentlicht `gw/<id>/ha/devices` aus `integrations/home-assistant/fixtures/devices.json` → Hardware erscheint unter „Neu erkannt“ (wie in `ha-ingest.e2e-spec.ts` prüfen).
  - **Zweimal parallel einlösen** (`Promise.all`) → genau einmal 200, einmal 404; genau ein Gateway in der DB.
  - Kleingeschriebener Code mit Leerzeichen → 200.
  - Neu koppeln: Code mit `gatewayId` → einlösen mit `expectedGatewayId` → 200, gleiche ID, alter Schlüssel abgewiesen; Code für neues Gateway mit `expectedGatewayId` → 409, danach ohne `expectedGatewayId` einlösbar.
  - Sperren durch den Eigentümer → verbundener Client getrennt, erneutes Verbinden abgewiesen; „Neu koppeln“ für das gesperrte Gateway → 404.
  - Sechstes Gateway → 409 `gateway.limitReached`.
  - Ohne `GATEWAY_CREDENTIAL_SECRET` (eigene App-Instanz im Test) → 503, Code bleibt gültig.
  - Elftes Einlösen von derselben IP in 15 min → 429.
- [ ] **Step 5: Grün.** `pnpm --filter @smart/backend test -- pairing ha-pairing`, `pnpm test:tz`, `pnpm lint && pnpm typecheck`.
- [ ] **Step 6: Commit.** `feat(backend): pair home assistant gateways with a code`

---

### Task 6: Frontend – Koppeln, Neu koppeln, Einträge

**Files:**

- Modify: `apps/frontend/src/app/features/gateways/gateways.api.ts` (`createPairing(householdId, gatewayId?)`)
- Create: `apps/frontend/src/app/features/gateways/pairing-panel.ts` (+ Spec)
- Modify: `gateways-page.ts` (+ Spec), `register-form.ts` (+ Spec: Art-Auswahl entfernt, sendet `kind: 'z2m'` nicht mehr mit oder fest `'z2m'`), `i18n/de.json`, `i18n/en.json`

**Interfaces:**

- Consumes: `POST …/gateway-pairings` → `GatewayPairing`; `Gateway.auth`, `certExpiresAt: string | null` (Task 3); Fehler `gateway.limitReached`.
- Produces: `<app-gateway-pairing-panel [householdId] [gatewayId]? (paired)="…" />` – zeigt Knopf „Code erzeugen“, danach Code, „gültig bis“ (`uiDateTime`, Haushaltszone), Adresse mit Kopierknopf, drei Schritte, Link `https://my.home-assistant.io/redirect/config_flow_start/?domain=smart_bridge` und Anleitungs-Link `https://github.com/tkosiol/smart-home-hacs`; fragt alle 5 s die Gateway-Liste ab, solange der Code gilt; neues Gateway (bzw. bei „Neu koppeln“: `lastMessageAt` jünger als die Code-Erzeugung) → „Verbunden: <Name>“, Code weg; abgelaufen → Hinweis und „Neuen Code erzeugen“.

- [ ] **Step 1: Failing specs** (Testmuster der bestehenden `gateways-page.spec.ts`, Stand-ins aus `@smart/ui/testing`): Eigentümer sieht „Home Assistant koppeln“, Nicht-Eigentümer nicht; Code erscheint nach Klick; Ablauf (Fake-Timer) zeigt Hinweis; Abfrage alle 5 s endet bei neuem Gateway mit „Verbunden“; `gateway.limitReached` → Meldung; Eintrag `credentials` zeigt „Gekoppelt über Home Assistant“ statt Zertifikatsablauf, „Neu koppeln“ und „Sperren“ für den Eigentümer (auch ohne Plattform-Admin); Eintrag `certificate` unverändert (Sperren nur Plattform-Admin); Offline-Hinweis bei `credentials` und `statusChangedAt` > 7 Tage mit Status offline; Registrierungsformular ohne Auswahl der Art.
- [ ] **Step 2: Fehlschlag sehen.** `pnpm --filter @smart/frontend test -- gateways`.
- [ ] **Step 3: Umsetzen** nur mit `@smart/ui`-Bausteinen (Abschnitt, Karte, Knöpfe, Banner, Kopieren wie an anderen Stellen der App; Code groß über vorhandene Typografie-Rolle, keine Komponenten-Styles außerhalb `@smart/ui`). Alle Texte über Schlüssel in `gateways`-Scope.
- [ ] **Step 4: Grün.** `pnpm --filter @smart/frontend test`, `pnpm i18n:check`, `pnpm lint && pnpm typecheck`, `pnpm build` (Bundle ≤ 425 kB, Wert im Bericht).
- [ ] **Step 5: Commit.** `feat(frontend): pair home assistant from the gateways page`

---

### Task 7: Integration – Config Flow, Reauth, WebSocket

**Files:**

- Create: `integrations/home-assistant/custom_components/smart_bridge/pairing.py` (HTTP-Einlösen, rein bis auf aiohttp), `config_flow.py`, `strings.json`, `translations/de.json`, `translations/en.json`
- Modify: `__init__.py` (ohne YAML: `async_setup_entry`, `async_unload_entry`), `connection.py` (WebSocket, Benutzer/Schlüssel, Auth-Fehler-Rückruf), `manifest.json` (`"name": "Smart Home"`, `"config_flow": true`, `"single_config_entry": true`, `"version": "0.2.0"`), `bridge.py` nur falls die Fabrik-Signatur es verlangt
- Test: `tests/test_pairing.py`, `tests/test_config_flow.py` (neu), `tests/test_init.py`, `tests/test_connection.py` (anpassen)

**Interfaces:**

- Consumes: `POST <url>/api/v1/gateway-pairing/redeem` (Task 5) → `{gatewayId, mqttUrl, username, password, clientId}`.
- Produces:

  ```python
  # pairing.py
  class PairingError(Exception):
      def __init__(self, reason: str) -> None: ...  # invalid_code | other_gateway | limit_reached | unavailable | cannot_connect
  def validate_app_url(url: str) -> str: ...      # normalized "https://host[:port]" (no path); ValueError("insecure_url"|"invalid_url")
  async def redeem(session: aiohttp.ClientSession, app_url: str, code: str, name: str | None, expected_gateway_id: str | None) -> Credentials: ...
  @dataclass(frozen=True)
  class Credentials: gateway_id: str; mqtt_url: str; username: str; password: str; client_id: str
  # config entry data keys: url, gateway_id, mqtt_url, username, password, client_id
  # connection.py
  class PahoConnection:
      def __init__(self, *, gateway_id: str, mqtt_url: str, username: str, password: str, client_id: str,
                   on_connected: Callable[[], None], on_auth_failed: Callable[[], None]) -> None: ...
  ```

  `validate_app_url`: Schema `https` immer; `http` nur bei Host `localhost`, IPv4/IPv6 aus privaten/Loopback-Bereichen (`ipaddress.ip_address(h).is_private or .is_loopback`) oder Namen ohne Punkt; sonst `insecure_url`. Pfad, Query, Fragment werden verworfen, abschließender `/` entfernt.

- [ ] **Step 1: Failing tests.**
  - `test_pairing.py` (aiohttp-Mock aus `pytest_homeassistant_custom_component`, `aioclient_mock`): Erfolg → `Credentials`; 404 → `invalid_code`; 409 mit `{"code":"gateway.pairingOtherGateway"}` → `other_gateway`, mit `gateway.limitReached` → `limit_reached`; 503 → `unavailable`; Zeitüberschreitung/Verbindungsfehler/500/kaputtes JSON → `cannot_connect`; `validate_app_url`: `https://smart.example.org/foo?x` → `https://smart.example.org`; `http://smart.example.org` → `insecure_url`; `http://192.168.1.5:8080`, `http://localhost`, `http://web` → angenommen; `ftp://x` → `invalid_url`. Der Request-Body enthält `code`, `name`, nur bei Reauth `expectedGatewayId`; die Antwort wird nicht geloggt (`caplog` enthält weder Code noch Passwort).
  - `test_config_flow.py`: Schritt `user` → Formular; gültige Eingabe → Eintrag mit Titel = Ortsname, `unique_id` = Gateway-ID, Daten wie oben; Fehler je Grund im Formular (`errors["base"]`, `insecure_url` am Feld `url`); zweiter Eintrag → Abbruch `single_instance_allowed`; Reauth: `entry.async_start_reauth` → `reauth_confirm` → neuer Code → Eintrag aktualisiert und neu geladen; `other_gateway` → Fehler im Formular.
  - `test_init.py`: `async_setup_entry` startet die Bridge nach dem HA-Start und baut `PahoConnection` aus den Entry-Daten; `async_unload_entry` stoppt sie; YAML-Konfiguration `smart_bridge:` wird ignoriert (kein Fehler, keine Bridge).
  - `test_connection.py`: Client mit `transport="websockets"`, `ws_set_options(path="/mqtt")`, `username_pw_set(username, password)`, Client-ID aus den Daten, bei `wss` `tls_set_context` mit Hostnamenprüfung und System-CAs, bei `ws` ohne TLS; CONNACK mit „not authorized“/„bad user name or password“ → `on_auth_failed` einmal, Wiederverbinden gestoppt (`client.disconnect()`); andere Fehler wie bisher.
- [ ] **Step 2: Fehlschlag sehen.** `bash integrations/home-assistant/test/run-tests.sh` (Phase 1) → FAIL.
- [ ] **Step 3: Umsetzen.** Config Flow mit `ConfigFlow, domain=DOMAIN`, `VERSION = 1`, Session über `async_get_clientsession(hass)`, Zeitlimit 15 s; `name` = `hass.config.location_name`. Bei Auth-Fehler ruft `__init__.py` `entry.async_start_reauth(hass)` im Event-Loop (`call_soon_threadsafe`). `strings.json` mit Feldern `url` („Adresse der App“/„App address“), `code` („Kopplungscode“/„Pairing code“) und den Fehlern; `other_gateway`-Text wie Spec 4.2. YAML-Schema, Zertifikatsfelder und `_tls_context` mit Client-Zertifikat entfernen.
- [ ] **Step 4: Grün.** `bash integrations/home-assistant/test/run-tests.sh` (Phase 1: ruff + pytest; Phase 2 darf hier noch rot sein, Task 8 stellt sie um – dann den Lauf mit der vorhandenen Option nur Phase 1 bzw. pytest direkt im Container belegen und im Bericht nennen).
- [ ] **Step 5: Commit.** `feat(gateway): pair the home assistant integration with a code`

---

### Task 8: Integration im echten HA-Image (Phase 2)

**Files:**

- Modify: `integrations/home-assistant/test/run-tests.sh`, `test/ha-config/configuration.yaml` (ohne `smart_bridge:`-Block), neu `test/ha-config/.storage/core.config_entries.template` (oder Erzeugung im Skript)

**Interfaces:**

- Consumes: Broker-Image mit Listener 8080 (Task 1), Entry-Daten (Task 7).

- [ ] **Step 1: Test umstellen (rot).** Phase 2: Broker aus `infra/broker` ohne TLS-Zertifikate starten (nur 1883 + 8080), per `mosquitto_rr` als `smart-api` Rolle und Benutzer anlegen (wie Task 1), Config Entry für `smart_bridge` mit `mqtt_url` `ws://broker:8080/`, Benutzer, Schlüssel, Client-ID in `.storage/core.config_entries` des HA-Konfigordners schreiben (Format: `{"version":1,"minor_version":5,"key":"core.config_entries","data":{"entries":[{…}]}}` – Felder aus dem echten HA 2026.11.0 übernehmen: einmal einen Eintrag per Flow in einem Wegwerf-Container anlegen und die Datei ansehen, Ergebnis im Skript als Vorlage), HA starten. Prüfungen wie bisher in 180 s: `bridge/connection` = `1`, `ha/status` = `online`, Geräteliste mit `light`-Entität, Schnappschuss; nach `docker stop` `offline`/`0`; im Log kein `ERROR` von `smart_bridge`, keine Nutzlast, **kein Schlüssel**. Zusätzlich: Benutzer am Broker löschen → HA meldet im Log den Reauth-Bedarf (Zeile von `smart_bridge` bzw. Repair „reauth“), keine Endlosschleife von Verbindungsversuchen (höchstens 3 Versuche in 30 s im Broker-Log).
- [ ] **Step 2: Laufen lassen.** `bash integrations/home-assistant/test/run-tests.sh` → bis zur Umstellung rot, danach grün.
- [ ] **Step 3: Commit.** `test(gateway): run the paired integration in the real home assistant image`

---

### Task 9: Stack – Web-Nginx, Compose, Geheimnis, Durchstich

**Files:**

- Modify: `apps/frontend/nginx/default.conf` (`location = /mqtt`), ggf. Upstream-Variable wie `$api_upstream`
- Modify: `infra/compose/compose.yaml` (Broker-Alias `smart-broker-upstream` im Netz `internal`; API: `GATEWAY_CREDENTIAL_SECRET: ${GATEWAY_CREDENTIAL_SECRET:-}`)
- Modify: `infra/deploy/provision.sh` (`"GATEWAY_CREDENTIAL_SECRET=$(keep_or_generate GATEWAY_CREDENTIAL_SECRET)"`, Kommentar oben ergänzen) + `infra/deploy/test/run-tests.sh`
- Modify: `infra/compose/test/stack-test.sh` (Geheimnis in der Test-`.env`; Prüfung, dass `/mqtt` ein WebSocket-Upgrade annimmt)
- Create: `tests/e2e/specs/ha-pairing.spec.ts`, Helfer `tests/e2e/helpers/ha-pairing.ts` (Einlösen per `fetch`, Verbindung per `mqtt` über `ws://<web>/mqtt`; Abhängigkeit `mqtt` im Paket `tests/e2e` in derselben Version wie im Backend)

- [ ] **Step 1: Failing tests.** `provision.sh`-Test: neue `.env` enthält `GATEWAY_CREDENTIAL_SECRET` (≥ 32 Zeichen), `--force` behält den vorhandenen Wert. Stack-Test: `curl -i -N -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: …' -H 'Sec-WebSocket-Protocol: mqtt' http://<web>/mqtt` → `101`. Playwright `ha-pairing.spec.ts` (eigener Haushalt nach den Regeln in `CLAUDE.md`/`accounts.ts`, keine eigene Code-Anmeldung): Eigentümer klickt „Home Assistant koppeln“ → „Code erzeugen“, liest den Code; Helfer löst ihn über die Web-Adresse ein, verbindet sich über `ws://…/mqtt`, veröffentlicht `bridge/connection` `1`, `ha/status` `online`, Geräteliste und Schnappschuss aus den Fixtures; Seite zeigt „Verbunden: …“; unter „Geräte → Neu erkannt“ erscheint die Stehlampe.
- [ ] **Step 2: Fehlschlag sehen.** `bash infra/deploy/test/run-tests.sh`; `sh infra/compose/test/stack-test.sh`.
- [ ] **Step 3: Umsetzen.** Nginx:
  ```nginx
  # Paired gateways (Home Assistant) reach the broker's websocket listener here; TLS ends at the proxy in front.
  location = /mqtt {
    set $broker_upstream http://smart-broker-upstream:8080;
    proxy_pass $broker_upstream;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 120s;
    proxy_send_timeout 120s;
    proxy_buffering off;
  }
  ```
  (Resolver und Variable genauso wie beim bestehenden API-Upstream; Sicherheits-Header-Include nicht nötig.)
- [ ] **Step 4: Grün.** Dieselben Befehle; `pnpm lint && pnpm typecheck`.
- [ ] **Step 5: Commit.** `feat(infra): route /mqtt to the broker and provision the gateway key secret` und `test(repo): pair a home assistant through the stack`

---

### Task 10: Gateway-Paket – HA per Schalter, ohne HA-Secrets

**Files:**

- Modify: `gateway/deploy.sh`, `gateway/compose.yaml`, `gateway/homeassistant/configuration.yaml`, `gateway/README.md`
- Delete: `infra/deploy/provision-ha.sh` und seine Tests in `infra/deploy/test/run-tests.sh`; Eintrag in der Shellcheck-Liste in `.github/workflows/ci.yml`
- Test: `gateway/test/deploy-tests.sh`, `gateway/test/gateway-test.sh`

**Interfaces:**

- Produces: `SMART_PI=… pnpm gateway:deploy [--migrate | --fresh] [--ha on|off]` (Reihenfolge beliebig, jede Option höchstens einmal). HA ist an ⇔ `<dir>/homeassistant.enabled` existiert. `--ha on` legt die Datei an (root, 644), `--ha off` entfernt sie; ohne `--ha` bleibt der Zustand. rsync `--delete` schließt `/homeassistant.enabled` aus.

- [ ] **Step 1: Failing tests** (`deploy-tests.sh`, Muster der vorhandenen HA-Fälle): `--ha on` → Datei angelegt, HA-Schritt läuft (pull, up, warten); danach Deploy ohne Option → HA-Schritt läuft weiter; `--ha off` → Datei weg, Container per Labels gestoppt und entfernt; `--ha maybe`, `--ha` ohne Wert, doppelte Option → Usage, nichts kontaktiert; `--migrate --ha on` in beiden Reihenfolgen; vorhandenes `secrets/ha/` → Warnung „secrets/ha is no longer used …“, Deploy läuft; HA-Dienst in `compose.yaml` ohne `env_file` und ohne Secret-Mount; `curl`-Vorprüfung nur bei HA an. `gateway-test.sh`: `configuration.yaml` enthält keinen `smart_bridge`-Block, HA startet mit leerer Konfiguration der Integration.
- [ ] **Step 2: Fehlschlag sehen.** `bash gateway/test/deploy-tests.sh`, `bash gateway/test/gateway-test.sh`.
- [ ] **Step 3: Umsetzen.** Argumentschleife statt `case "${1:-}"`; alle Stellen, die `secrets/ha/ha.env` prüfen, auf `homeassistant.enabled` umstellen; `nohasecret`-Zweig und Zertifikatsprüfungen entfernen; Kopfkommentar von `deploy.sh` und `gateway/README.md` (Abschnitt „Home Assistant“) anpassen.
- [ ] **Step 4: Grün.** Dieselben Tests, `bash infra/deploy/test/run-tests.sh`, Shellcheck wie in der CI (`ops (shellcheck)`-Befehl aus `ci.yml` lokal).
- [ ] **Step 5: Commit.** `feat(gateway): switch home assistant with --ha and drop its secrets`

---

### Task 11: Verteilung über HACS

**Files:**

- Create: `integrations/home-assistant/release/hacs.json`, `integrations/home-assistant/release/README.md` (Installationsanleitung für das Spiegel-Repository, Deutsch und kurz Englisch), `integrations/home-assistant/release/sync-mirror.sh`, `integrations/home-assistant/release/test/sync-mirror-test.sh`
- Create: `.github/workflows/ha-integration-release.yml`; Modify: `.github/workflows/ci.yml` (Shellcheck-Liste, Suite für den Spiegel-Test in `ops`)

**Interfaces:**

- Produces: `sync-mirror.sh <mirror-git-url> <source-sha>`: klont den Spiegel, ersetzt den Inhalt durch `custom_components/smart_bridge/` (ohne `__pycache__`), `hacs.json`, `README.md`, `LICENSE` (aus der Repo-Wurzel), committet „sync from tkosiol/smart-home@<sha>“ nur bei Änderungen, pusht; gibt die Version aus `manifest.json` aus. Release (`gh release create v<version> --repo tkosiol/smart-home-hacs --notes …`) nur, wenn das Tag im Spiegel fehlt.
  `hacs.json`: `{ "name": "Smart Home", "homeassistant": "2026.10.0", "render_readme": true }`.

- [ ] **Step 1: Failing test** `sync-mirror-test.sh` gegen ein lokales Bare-Repository: erster Lauf → Commit mit genau den erwarteten Dateien; zweiter Lauf ohne Änderung → kein neuer Commit; geänderte Datei → neuer Commit; `__pycache__` nie im Spiegel; Ausgabe der Version = Wert aus `manifest.json`.
- [ ] **Step 2: Fehlschlag sehen.** `bash integrations/home-assistant/release/test/sync-mirror-test.sh`.
- [ ] **Step 3: Umsetzen.** Workflow: Auslöser `push` auf `main` mit `paths: ['integrations/home-assistant/**']` und `workflow_dispatch`; Job 1 führt `bash integrations/home-assistant/test/run-tests.sh` aus; Job 2 (`needs`) prüft `secrets.HACS_MIRROR_TOKEN` – leer → `::notice::` und Ende mit Erfolg; sonst `sync-mirror.sh "https://x-access-token:${TOKEN}@github.com/tkosiol/smart-home-hacs.git" "$GITHUB_SHA"` und Release wie oben (`GH_TOKEN` = Token). Aktionen mit festen Commit-SHAs wie in den vorhandenen Workflows; `permissions: contents: read`.
- [ ] **Step 4: Grün.** Test, `actionlint`/Shellcheck wie in der CI.
- [ ] **Step 5: Commit.** `ci: mirror the home assistant integration for hacs`

---

### Task 12: Dokumentation

**Files:**

- Create: `docs/adr/0023-paired-gateways-with-broker-credentials.md`, Zeile in `docs/adr/README.md`
- Modify: `docs/adr/0002-gateway-mqtt-bridge-mtls.md` (Nachtrag: gilt für Zertifikats-Gateways; gekoppelte Gateways siehe ADR-0023), `docs/adr/0022-home-assistant-integration.md` (Nachtrag: YAML/mTLS entfällt, Kopplung per Code)
- Modify: `docs/runbooks/gateway.md` (Abschnitt 13 neu: HA auf dem Pi mit `--ha on`, Koppeln, Neu koppeln, Sperren, Fehlerbilder: „Websockets Support“ fehlt → HA meldet `cannot_connect`/Verbindungsabbrüche, 503 ohne Geheimnis, Reauth), `docs/runbooks/provisioning.md` (`GATEWAY_CREDENTIAL_SECRET`, `provision.sh --force`, NPM „Websockets Support“ je Proxy-Host, Geheimnis ändern = alle HA neu koppeln), `docs/architecture/overview.md`, `integrations/home-assistant/README.md` (Konfiguration per Config Flow, Verbindung, Reauth, Verteilung), `CLAUDE.md` (Befehlstabelle: Spiegel-Test; Hinweis „Lokale Ports“: 8084 WebSocket-Listener)
- Modify: `docs/superpowers/specs/2026-11-20-ha-kopplung-design.md` (Abschnitt 15 „Nachtrag (Umsetzung)“ mit allen Abweichungen und Rulings)

- [ ] **Step 1: Schreiben**, Deutsch, ohne Hostnamen/IPs (Platzhalter `<app-adresse>`). Tills einmalige Schritte (Spec 11) im Runbook als nummerierte Liste.
- [ ] **Step 2: Prüfen.** `pnpm lint` (Prettier/Markdown), `git grep -nE -f .local/private-patterns.txt -- .` leer.
- [ ] **Step 3: Commit.** `docs: home assistant pairing (adr 0023, runbooks)`
