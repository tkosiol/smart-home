# Selbst-Kopplung von Home Assistant – Design

- Status: angenommen (Till: Ansatz „Zugangsschlüssel“ mit WebSocket über 443, YAML/mTLS-Weg für HA entfällt, autonome Umsetzung, 2026-11-20)
- Baut auf: ADR-0002, ADR-0021, ADR-0022, `docs/superpowers/specs/2026-11-19-home-assistant-adapter-design.md`

## 1. Ziel

Wer ein Konto hat, bindet seine eigene Home-Assistant-Installation (HA) **ohne Till und ohne Dateien** an: In der App einen Kopplungscode erzeugen, in HA die Integration über HACS installieren, über die Oberfläche hinzufügen, Adresse und Code eingeben – fertig. Die Geräte erscheinen unter „Geräte → Neu erkannt“.

Erfolgskriterien:

- Ein Eigentümer eines Haushalts (nicht nur der Plattform-Admin) koppelt ein HA-Gateway vollständig im Browser bzw. in der HA-Oberfläche; kein Zertifikat, kein Terminal, kein Schritt auf Tills Mac.
- Sperren in der App trennt das Gateway sofort vom Broker.
- Die Offline-CA bleibt offline; Tills Pi (Zigbee2MQTT-Bridge) bleibt bei mTLS über Port 8883, unverändert.
- Der Zugang ist so gebaut, dass er auch Fremden standhält (Etappe „offene Registrierung“ folgt): Codes laufen ab, sind einmalig und begrenzt, Zugänge sind einzeln sperrbar, ein Gateway kann nur unter seinem eigenen Präfix schreiben und keine fremde Verbindung verdrängen.
- Tills eigenes HA auf dem Pi wird genauso gekoppelt (ein Weg für alle).

**Nicht in dieser Etappe:** offene Registrierung und der Schalter „nur auf Einladung“ (eigene Etappe danach), Befehle (6c-3; die Rolle am Broker bekommt dann `gw/%u/ha/command`), Aufnahme in die Standardliste von HACS, Kopplung von Zigbee2MQTT-Gateways per Code.

## 2. Begriffe

- **Kopplungscode:** 8 Zeichen aus dem Crockford-Base32-Alphabet (`0-9`, `A-Z` ohne `I L O U`), angezeigt als `XXXX-XXXX`; 15 Minuten gültig, einmal einlösbar. Gilt entweder für **ein neues Gateway** im Haushalt oder für **ein bestehendes** HA-Gateway („neu koppeln“).
- **Zugangsart eines Gateways (`auth`):** `certificate` (bisher: Client-Zertifikat der Offline-CA, mTLS über 8883) oder `credentials` (neu: Benutzer und Schlüssel am Broker, WebSocket über 443). HA-Gateways haben ab jetzt immer `credentials`, Z2M-Gateways immer `certificate`.
- **Generation:** Zähler je `credentials`-Gateway (ab 1). Jedes „Neu koppeln“ erhöht ihn; der Schlüssel hängt davon ab, der alte wird damit ungültig.
- **Zugangsschlüssel:** das Broker-Passwort eines `credentials`-Gateways, vom Backend abgeleitet (Abschnitt 5.3), nirgends gespeichert.
- **Abgleich:** das Backend bringt die Benutzer des Plugins Dynamic Security am Broker auf den Stand der Datenbank.

## 3. Architektur

```
App (Eigentümer) ──POST gateway-pairings──▶ Backend: Code (gehasht) in gateway_pairings
HA Config Flow ──POST gateway-pairing/redeem (Code, HTTPS)──▶ Backend: Gateway anlegen / Generation erhöhen
                                                              └─▶ Broker: $CONTROL/dynamic-security/v1 (über 1883)
HA smart_bridge ──wss://<app>/mqtt (Benutzer = Gateway-ID, Schlüssel)──▶ NPM ─▶ web-nginx /mqtt ─▶ Broker :8080 (websockets, Dynamic Security)
                                                                                   gw/<id>/ha/…, gw/<id>/bridge/connection ─▶ GatewayIngest ─▶ HaAdapter
Pi Z2M-Bridge ──mTLS :8883 (unverändert)──▶ Broker
```

- Ab dem Broker ist alles wie in der HA-Etappe: gleiches Protokoll v1, gleicher Adapter `ha`, gleiche Topics.
- Die Quelle der Wahrheit für Zugänge ist die Datenbank. Der Broker hält die Benutzer von Dynamic Security nur im tmpfs; nach jedem Start legt das Backend sie beim Abgleich wieder an. Darum braucht der Broker kein Backup und kein Geheimnis auf seinem Volume.

## 4. Abläufe

### 4.1 Koppeln (neues Gateway)

1. Eigentümer: Gateways → „Home Assistant koppeln“ → „Code erzeugen“. Die App zeigt Code, Ablaufzeit, die Adresse der Instanz (`APP_ORIGIN`) zum Kopieren, die drei Schritte und den Link „In Home Assistant öffnen“ (`https://my.home-assistant.io/redirect/config_flow_start/?domain=smart_bridge`) sowie den Link zur Installationsanleitung (HACS).
2. In HA: HACS → benutzerdefiniertes Repository (Abschnitt 9) → „Smart Home“ installieren → HA neu starten → Einstellungen → Geräte & Dienste → Integration hinzufügen → „Smart Home“. Felder: **Adresse der App** und **Kopplungscode**.
3. Die Integration ruft `POST <adresse>/api/v1/gateway-pairing/redeem` mit `{ code, name }` auf (`name` = Ortsname von HA, `hass.config.location_name`).
4. Das Backend legt in einer Transaktion das Gateway an (`kind = ha`, `auth = credentials`, Generation 1, neue zufällige ID `gw-xxxxxxxx`), markiert den Code als eingelöst, legt am Broker den Benutzer an und gibt `{ gatewayId, mqttUrl, username, password, clientId }` zurück. Scheitert der Broker-Schritt, wird die Transaktion zurückgerollt: kein Gateway, Code weiter gültig, Antwort 503.
5. HA speichert die Antwort im Config Entry und verbindet sich. Die App-Seite sieht das neue Gateway (sie fragt die Liste alle 5 s ab, solange ein Code angezeigt wird) und meldet „Verbunden: <Name>“.

### 4.2 Neu koppeln (bestehendes HA-Gateway)

Für ein nicht gesperrtes `credentials`-Gateway: „Neu koppeln“ erzeugt einen Code, der an dieses Gateway gebunden ist. Einlösen erhöht die Generation (neuer Schlüssel, der alte gilt nicht mehr), setzt das Passwort am Broker und trennt bestehende Verbindungen mit dem alten Schlüssel. ID, Hardware, Geräte und Messwerte bleiben.

In HA führt ein abgewiesener Schlüssel (CONNACK „nicht autorisiert“) zum Standard-Ablauf „Erneut authentifizieren“; dort gibt man den neuen Code ein. Die Integration schickt dabei `expectedGatewayId` mit. Gehört der Code zu einem anderen Ziel (anderes Gateway oder neues Gateway), antwortet das Backend 409 **ohne** den Code zu verbrauchen; HA sagt dann: „Dieser Code gehört zu einem anderen Gateway. Erzeuge in der App bei diesem Gateway ‚Neu koppeln‘, oder entferne die Integration und füge sie neu hinzu.“

### 4.3 Sperren

Eigentümer (für `credentials`-Gateways) bzw. Plattform-Admin (für `certificate`-Gateways, wie bisher): „Sperren“. Das Backend setzt `revoked_at`, löscht den Broker-Benutzer, und der Broker trennt die Verbindung sofort. Ist der Broker gerade nicht erreichbar, holt der nächste Abgleich das nach. Ein gesperrtes Gateway lässt sich nicht neu koppeln; die ID wird nie wiederverwendet. HA zeigt danach „Erneut authentifizieren“; ein neuer Code für ein neues Gateway führt über „Integration entfernen und neu hinzufügen“.

### 4.4 Integration in HA entfernt

HA meldet `offline`/`0` und trennt. Das Gateway bleibt in der App (Status offline), bis der Eigentümer es sperrt; die App weist bei einem `credentials`-Gateway, das seit mehr als 7 Tagen offline ist, im Eintrag darauf hin („Wird es nicht mehr genutzt? Dann sperren.“).

## 5. Backend

### 5.1 Daten (Migration 0013)

`gateways`:

- `auth text not null default 'certificate'`, Check `in ('certificate','credentials')`.
- `credential_generation integer` (null bei `certificate`).
- `cert_fingerprint`, `cert_expires_at` werden nullable.
- Check `gateways_auth_check`: entweder `auth = 'certificate'` mit Fingerabdruck und Ablauf gesetzt und ohne Generation, oder `auth = 'credentials'` mit `kind = 'ha'`, `credential_generation >= 1` und ohne Fingerabdruck und Ablauf.

Neue Tabelle `gateway_pairings`:

| Spalte         | Typ                      | Bedeutung                                    |
| -------------- | ------------------------ | -------------------------------------------- |
| `id`           | uuid, PK                 |                                              |
| `household_id` | uuid, FK, cascade        | Haushalt des neuen bzw. bestehenden Gateways |
| `gateway_id`   | text, FK, cascade, null  | gesetzt bei „Neu koppeln“                    |
| `code_hash`    | text, unique             | SHA-256 des normalisierten Codes             |
| `created_by`   | uuid, FK users, set null | wer den Code erzeugt hat                     |
| `created_at`   | timestamptz              |                                              |
| `expires_at`   | timestamptz              | `created_at` + 15 min                        |
| `used_at`      | timestamptz, null        | eingelöst                                    |

Ein neuer Code macht offene (nicht eingelöste, nicht abgelaufene) Codes **desselben Ziels** (Haushalt ohne Gateway bzw. dasselbe Gateway) ungültig (`expires_at = now`). Eingelöste und abgelaufene Zeilen löscht ein täglicher Aufräumlauf nach 7 Tagen.

### 5.2 API und Contracts

- `Gateway` bekommt `auth: 'certificate' | 'credentials'`; `certExpiresAt` wird `string | null`. Warnungen zu Zertifikat und Sperrliste gibt es nur für `certificate`-Gateways (die Sperrlisten-Warnung der Seite erscheint nur, wenn der Haushalt ein solches hat).
- `POST /api/v1/households/:householdId/gateway-pairings` – Rolle `owner`, Rate-Limit `gatewayPairingCreatePerIp` (20 je 15 min). Body `{ gatewayId?: string }`. Antwort 201 `{ code: "XXXX-XXXX", expiresAt, appUrl }`. Mit `gatewayId`: muss ein nicht gesperrtes `credentials`-Gateway dieses Haushalts sein, sonst 404 `household.notFound`. Ohne: 409 `gateway.limitReached`, wenn der Haushalt schon 5 nicht gesperrte `credentials`-Gateways hat.
- `POST /api/v1/gateway-pairing/redeem` – `@Public()`, ohne Origin-Prüfung (neuer Dekorator `@SkipOriginCheck()`: der Endpunkt liest keine Cookies und keine Sitzung, er wird nur über den Code im Body berechtigt), Rate-Limit `gatewayPairingRedeemPerIp` (10 je 15 min). Body `{ code: string, name?: displayName, expectedGatewayId?: gatewayId }`; der Code wird normalisiert (Großbuchstaben, ohne Leerzeichen und Bindestrich, `O→0`, `I/L→1`). Antworten:
  - 200 `{ gatewayId, mqttUrl, username, password, clientId }` – `username` = `gatewayId`, `clientId` = `<gatewayId>-ha`, `mqttUrl` aus `APP_ORIGIN` (`https:` → `wss:`, `http:` → `ws:`) plus `/mqtt`.
  - 404 `gateway.pairingInvalid` – unbekannt, abgelaufen oder eingelöst (immer dieselbe Antwort).
  - 409 `gateway.pairingOtherGateway` – `expectedGatewayId` passt nicht zum Ziel des Codes (Code bleibt gültig).
  - 409 `gateway.limitReached` – siehe oben (beim Einlösen erneut geprüft).
  - 503 `gateway.pairingUnavailable` – `GATEWAY_CREDENTIAL_SECRET` fehlt oder der Broker hat nicht bestätigt (Code bleibt gültig).
  - Die Antwort trägt `Cache-Control: no-store`; das Passwort wird nie geloggt.
- Sperren (`POST …/gateways/:gatewayId/revoke`): `owner` genügt für `credentials`-Gateways; für `certificate`-Gateways bleibt der Plattform-Admin nötig (die Sperrliste entsteht auf Tills Mac). Prüfung im Service, Antwort sonst 403 `auth.forbidden`.
- Registrieren per Zertifikat (`POST …/gateways`) nimmt nur noch `kind = z2m` an; `ha` mit Zertifikat → 400 `validation.failed`. Das Formular in der App verliert die Auswahl der Art.
- Ereignisse: Einlösen sendet `GATEWAY_REGISTERED` (neues Gateway) wie bisher das Registrieren; „Neu koppeln“ sendet nichts Neues.

### 5.3 Zugangsschlüssel

`password = base64url(HMAC-SHA256(GATEWAY_CREDENTIAL_SECRET, "smart-gateway-credential\0<gatewayId>\0<generation>"))` (43 Zeichen).

- `GATEWAY_CREDENTIAL_SECRET`: neue Umgebungsvariable (mindestens 32 Zeichen), erzeugt von `infra/deploy/provision.sh` (`keep_or_generate`, also einmal `provision.sh --force` je Umgebung, Till). Ohne sie: Kopplung antwortet 503, der Abgleich ruht (eine Warnung pro Stunde im Log), alles andere läuft.
- Warum abgeleitet statt gespeichert: Das Backend kann jeden Zugang jederzeit neu am Broker anlegen (Neustart, verlorenes tmpfs), ohne Passwörter oder umkehrbare Werte in der Datenbank. Wer das Geheimnis kennt, kennt alle Schlüssel – dieselbe Stufe wie `MQTT_API_PASSWORD`, mit dem man ohnehin unter `gw/#` lesen und schreiben kann.
- Das Geheimnis zu ändern macht alle Schlüssel ungültig (alle HA müssen neu gekoppelt werden); das steht im Runbook.

### 5.4 Broker-Abgleich

Baustein `GatewayCredentials` in `core/gateways` über die Plattform-MQTT-Verbindung (die dafür `publish()` und einen Hinweis auf jeden Verbindungsaufbau bekommt). Befehle gehen als JSON an `$CONTROL/dynamic-security/v1`, Antworten kommen auf `$CONTROL/dynamic-security/v1/response` und werden über `correlationData` zugeordnet; Zeitlimit 5 s je Anfrage, eine Anfrage zur Zeit.

- **Einzelschritte:** Anlegen (`createClient` mit `username`, `password`, `clientid = <id>-ha`, Rolle `smart-gateway-ha`), neuer Schlüssel (`setClientPassword`, danach `disableClient` + `enableClient`, damit Verbindungen mit dem alten Schlüssel getrennt werden), Löschen (`deleteClient`).
- **Abgleich** nach jedem Verbindungsaufbau des Backends und alle 10 Minuten:
  1. `setDefaultACLAccess`: `publishClientSend`, `publishClientReceive`, `subscribe` verboten; `unsubscribe` erlaubt.
  2. Rolle `smart-gateway-ha` mit genau diesen Regeln (anlegen; existiert sie, ihre Regeln ersetzen): `publishClientSend` erlaubt für `gw/%u/ha/#` und `gw/%u/bridge/connection`.
  3. `listClients`; für jedes nicht gesperrte `credentials`-Gateway: fehlt der Benutzer → anlegen, sonst `setClientPassword` (idempotent); jeder Benutzer ohne nicht gesperrtes Gateway → löschen.
- Die Planung (Soll gegen Ist → Befehle) ist eine reine Funktion und einzeln getestet.
- Fehler (Zeitlimit, Fehlermeldung des Plugins) werden geloggt (ohne Passwörter); der nächste Lauf versucht es erneut.

### 5.5 Sicherheit und Grenzen

- Codes: 40 Bit Zufall, nur der SHA-256 wird gespeichert, 15 min, einmalig, neuer Code entwertet den vorigen desselben Ziels; Einlösen begrenzt auf 10 je IP in 15 min. Das Einlösen sperrt die Code-Zeile (`FOR UPDATE`), damit ein Code nicht zweimal eingelöst wird.
- Je Haushalt höchstens 5 nicht gesperrte `credentials`-Gateways.
- Am Broker: Rechte nur über die Rolle (eigenes Präfix über `%u`), Standard „verboten“; die Client-ID ist an den Benutzer gebunden (`clientid`), so dass ein Gateway keine fremde Verbindung (auch nicht die des Backends) übernehmen kann; `max_connections 500` am WebSocket-Listener.
- Die Integration nimmt nur `https://`-Adressen an; `http://` nur für `localhost`, IP-Adressen aus privaten Bereichen und Namen ohne Punkt (eigene Installationen im Heimnetz, Tests).

## 6. Broker und Web

- `infra/broker`: neuer Listener `8080` mit `protocol websockets`, nur im internen Docker-Netz (nie veröffentlicht), `allow_anonymous false`, Plugin `/usr/lib/mosquitto_dynamic_security.so` mit `plugin_opt_config_file /mosquitto/run/dynsec.json`. `entrypoint.sh` schreibt bei jedem Start eine leere Konfiguration (keine Benutzer, keine Rollen, Standard verboten) in das tmpfs. Die ACL-Datei erlaubt `smart-api` zusätzlich `$CONTROL/dynamic-security/#`. 1883 und 8883 bleiben unverändert.
- `apps/frontend/nginx/default.conf`: `location = /mqtt` mit WebSocket-Upgrade zum Broker unter einem eindeutigen Alias (`smart-broker-upstream`, wie beim API-Upstream), `proxy_read_timeout 120s`, ohne Puffer.
- `infra/compose/compose.yaml`: Alias für den Broker im internen Netz, `GATEWAY_CREDENTIAL_SECRET` für die API.
- Nginx Proxy Manager: „Websockets Support“ am Proxy-Host je Umgebung einschalten (Till, einmalig; Runbook).
- Lokale Infrastruktur (`pnpm infra:up`): derselbe Listener, `ng serve` leitet `/mqtt` per `proxy.conf.json` (WebSocket) weiter.

## 7. Integration `smart_bridge` (Version 0.2.0)

- Anzeigename „Smart Home“, Domain bleibt `smart_bridge`. `manifest.json`: `config_flow: true`, `single_config_entry: true`, Version `0.2.0`.
- **YAML entfällt** (Schema, `async_setup` aus YAML, Zertifikatsdateien, mTLS-Kontext). Einrichtung nur über den Config Flow; `async_setup_entry` startet die Bridge (nach dem HA-Start), `async_unload_entry` stoppt sie.
- **Config Flow `user`:** Felder Adresse, Code; prüft das Schema der Adresse (5.5), ruft das Einlösen über HAs aiohttp-Sitzung auf (Zeitlimit 15 s), Fehler `invalid_code` (404), `limit_reached` (409 limit), `unavailable` (503), `cannot_connect` (Netz, TLS, andere Antworten). Titel = Name, `unique_id` = Gateway-ID; Daten: `url`, `gateway_id`, `mqtt_url`, `username`, `password`, `client_id`.
- **Reauth:** lehnt der Broker die Anmeldung ab, startet die Integration den Reauth-Ablauf (`entry.async_start_reauth`) und versucht es nicht weiter; der Schritt `reauth_confirm` fragt einen Code, schickt `expectedGatewayId`, Fehler `other_gateway` (409), aktualisiert den Eintrag und lädt ihn neu.
- **Verbindung:** paho mit `transport="websockets"`, Pfad aus `mqtt_url`, `username_pw_set`, bei `wss` TLS mit den System-CAs und Prüfung des Hostnamens (`ssl.create_default_context()`); Client-ID aus der Antwort. Will, Wiederverbindung, Status, Nutzlasten und Ablauf bleiben wie in der HA-Etappe.
- Übersetzungen der Oberfläche: `strings.json` und `translations/de.json`, `translations/en.json`.

## 8. Frontend

- Gateway-Seite (`features/gateways`):
  - Abschnitt „Home Assistant koppeln“ für Eigentümer: Knopf „Code erzeugen“; danach Code groß, „gültig bis <Uhrzeit>“, Adresse mit Kopierknopf, drei Schritte, Link „In Home Assistant öffnen“, Link „Anleitung“ (HACS-Repository). Solange der Code gilt, fragt die Seite die Gateway-Liste alle 5 s ab; erscheint ein neues Gateway, zeigt sie „Verbunden: <Name>“ und blendet den Code aus. Ist der Code abgelaufen: Hinweis und „Neuen Code erzeugen“.
  - Eintrag eines `credentials`-Gateways: statt Zertifikatsablauf „Gekoppelt über Home Assistant“; Aktionen „Neu koppeln“ (zeigt den Code wie oben, gebunden an dieses Gateway) und „Sperren“ (Eigentümer). Hinweis nach 7 Tagen offline (4.4).
  - Registrieren per Zertifikat bleibt für Plattform-Admins, nur noch für Zigbee2MQTT (keine Auswahl der Art).
- Texte in `features/gateways/i18n` (de, en).

## 9. Verteilung über HACS

HACS verlangt die Integration unter `custom_components/<domain>/` in der Wurzel eines eigenen Repositorys; ein Unterordner dieses Monorepos geht nicht. Darum:

- Quelle bleibt `integrations/home-assistant/` (Tests, Beispieldateien, gemeinsamer Vertrag mit dem Backend).
- Neues öffentliches Repository `tkosiol/smart-home-hacs` (legt Till an, leer) enthält nur `custom_components/smart_bridge/`, `hacs.json` (`name: "Smart Home"`, `homeassistant: "2026.10.0"`, `render_readme: true`), `README.md` (Installationsanleitung) und `LICENSE` (AGPL).
- Workflow `ha-integration-release.yml`: bei jedem Push auf `main`, der `integrations/home-assistant/**` ändert, nach grünen Tests: Inhalt spiegeln (ein Commit „sync from tkosiol/smart-home@<sha>“), und wenn die Version in `manifest.json` noch kein Release hat, ein Release `v<version>` anlegen. Zugang über ein Fine-grained-Token `HACS_MIRROR_TOKEN` (nur `contents: write` auf das Spiegel-Repository; Till legt es an). Ohne Token endet der Job mit einem Hinweis, nicht rot.
- Das Skript dazu (`integrations/home-assistant/release/sync-mirror.sh`) ist ohne GitHub testbar (lokales Bare-Repository).

## 10. Pi: Gateway-Paket

- HA ist an, wenn die Datei `homeassistant.enabled` im Gateway-Ordner liegt. `pnpm gateway:deploy --ha on|off` legt sie an bzw. entfernt sie; ohne Option bleibt der Zustand. Der Rest des HA-Schritts (eigener, nicht fataler Schritt, Pull, `--force-recreate`, Warten auf 8123, Entfernen bei „aus“ über die Labels) bleibt.
- Entfällt: `infra/deploy/provision-ha.sh`, `secrets/ha/` (Zertifikate, `ha.env`), die Prüfungen dazu, der `smart_bridge`-Block in `gateway/homeassistant/configuration.yaml`, Umgebung und Secret-Mount des HA-Dienstes. Liegt noch ein `secrets/ha/` auf dem Pi, warnt der Deploy, dass es nicht mehr genutzt wird.
- Die Integration kommt auf dem Pi weiter mit dem Deploy (kein HACS nötig); gekoppelt wird sie wie überall über die Oberfläche.

## 11. Betrieb (Tills einmalige Schritte)

1. `infra/deploy/provision.sh --force` je Umgebung (erzeugt `GATEWAY_CREDENTIAL_SECRET`, behält alles andere).
2. Nginx Proxy Manager: „Websockets Support“ an den Proxy-Hosts von Staging und Produktion.
3. Öffentliches Repository `smart-home-hacs` anlegen, Token `HACS_MIRROR_TOKEN` als Actions-Secret dieses Repositorys hinterlegen.
4. Pi: `pnpm gateway:deploy --ha on`, HA-Konto anlegen, Integration hinzufügen, Code aus der App.

Runbooks: `docs/runbooks/gateway.md` (Abschnitt 13 neu: Kopplung statt Provisionierung, Sperren, Neu koppeln, Fehlerbilder), `docs/runbooks/provisioning.md` (Geheimnis, Websockets am Proxy). ADR-0023 (Zugang gekoppelter Gateways), Nachträge in ADR-0002 und ADR-0022.

## 12. Tests

- **Backend (Unit):** Code erzeugen, normalisieren, hashen; Schlüssel ableiten (feste Testvektoren); Kopplungs-Service (Ablauf, einmalig, Entwerten, Ziel-Prüfung, Grenze, Rollback bei Broker-Fehler); Abgleich-Planung (Soll/Ist → Befehle); Zuordnung von Antworten, Zeitlimit; Rechte beim Sperren.
- **Backend (E2E, echter Broker):** Code erzeugen → einlösen → per WebSocket mit dem Schlüssel verbinden → Geräteliste veröffentlichen → Hardware erscheint; falscher Schlüssel und fremde Client-ID abgewiesen; fremdes Präfix verworfen; Sperren trennt und weist ab; Neu koppeln: alter Schlüssel abgewiesen, neuer geht; Broker-Neustart → Abgleich stellt Zugänge wieder her; Einlösen ohne `Origin`.
- **Broker-Test:** WebSocket-Listener, Standard verboten, Rolle mit `%u`, Bindung der Client-ID, `smart-api` steuert über 1883, andere dürfen `$CONTROL` nicht.
- **Integration (pytest):** Config Flow (Erfolg, ungültiger Code, Grenze, nicht erreichbar, Regel für `http`, nur ein Eintrag), Reauth (Erfolg, anderes Gateway), Setup/Unload, Verbindung über WebSocket (Optionen an paho), Auslösen von Reauth bei abgewiesener Anmeldung.
- **Integration (Phase 2, echtes HA):** Config Entry vorab in `.storage` angelegt, echter Broker mit WebSocket-Listener und per `$CONTROL` angelegtem Benutzer: `online`, Geräteliste, Schnappschuss, nach Stopp `offline`/`0`.
- **Frontend:** Code erzeugen und anzeigen, Ablauf, Abfrage bis „Verbunden“, Neu koppeln, Sperren durch Eigentümer, Eintrag eines `credentials`-Gateways, Formular nur noch Z2M.
- **Stack (Playwright):** Eigentümer erzeugt einen Code in der App; ein Test-Helfer löst ihn über die Web-Adresse ein und verbindet sich über `ws://…/mqtt` durch das Web-Nginx; das Gerät erscheint unter „Neu erkannt“.
- **Gateway-Paket:** `--ha on|off`, Warnung bei altem `secrets/ha/`.
- **Spiegel-Skript:** gegen ein lokales Bare-Repository (Inhalt, kein Release ohne neue Version).

## 13. Entscheidungen (autonom getroffen, zur Prüfung)

1. **Abgeleitete Schlüssel, flüchtiger Broker-Zustand** (5.3, 3) statt gespeicherter Hashes am Broker: kein Backup des Broker-Volumes nötig, Neustart heilt sich selbst. Kostet bei Irrtum: ein Geheimnis mehr; dessen Verlust heißt alle HA neu koppeln.
2. **Eigentümer koppeln und sperren `credentials`-Gateways selbst** (5.2), Zertifikats-Gateways bleiben beim Plattform-Admin. Kostet bei Irrtum: eine Rechteprüfung zurückdrehen.
3. **Code-Format und Fristen** (2, 5.5): 8 Zeichen Crockford, 15 min, einmalig. Kostet bei Irrtum: Konstanten.
4. **Höchstens 5 `credentials`-Gateways je Haushalt.** Kostet bei Irrtum: Konstante.
5. **Reauth nur für dasselbe Gateway** (4.2), Code wird bei falschem Ziel nicht verbraucht. Kostet bei Irrtum: ein Sonderfall im Flow.
6. **Einlösen ohne Origin-Prüfung** über einen ausdrücklichen Dekorator; der Endpunkt nutzt keine Cookies. Kostet bei Irrtum: HA müsste einen `Origin`-Header setzen.
7. **Client-ID an den Benutzer gebunden** (`<id>-ha`), verhindert das Verdrängen fremder Verbindungen. Kostet bei Irrtum: nichts, die Integration nutzt diese ID schon.
8. **HACS über ein Spiegel-Repository** mit Release je Version. Kostet bei Irrtum: ein Repository und ein Token.
9. **Pi-Schalter als Datei** `homeassistant.enabled` mit `--ha on|off` statt der Secrets-Datei. Kostet bei Irrtum: eine Option im Deploy.
10. **`http://` nur für lokale Adressen** in der Integration. Kostet bei Irrtum: eine Prüfung lockern.
11. **Zertifikats-Registrierung nur noch für Z2M**; HA nur noch über Kopplung. Kostet bei Irrtum: Auswahl im Formular zurück.
12. **Hinweis „seit 7 Tagen offline“** statt automatischem Sperren. Kostet bei Irrtum: ein Text.

## 14. Leitplanken (nicht gebaut)

- Offene Registrierung: Kontingente je Konto, Missbrauchsschutz beim Einlösen über mehr als nur IP-Grenzen, Größenlimit für Nachrichten am WebSocket-Listener (`max_packet_size`), Messung des Brokers bei vielen Verbindungen.
- Zigbee2MQTT-Gateways könnten später ebenfalls per Code gekoppelt werden (die Bridge bräuchte dann Benutzer und Schlüssel statt mTLS).
- Aufnahme in die Standardliste von HACS (eigene Marken-Icons, Prüfungen von HACS).
