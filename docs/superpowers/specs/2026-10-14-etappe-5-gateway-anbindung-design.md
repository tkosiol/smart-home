# Etappe 5: Gateway-Anbindung – Spec

|        |                                                                                                                                                     |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status | Entwurf zur Freigabe                                                                                                                                |
| Datum  | 2026-10-14                                                                                                                                          |
| Bezug  | Architektur-Spec Abschnitte 3, 4, 8.4, 8.5, 9, 11.3; ADR-0002, ADR-0003, ADR-0004, ADR-0017, ADR-0018, ADR-0020 (Ergebnis Spike 2b); `.local/pi.md` |

## 0. Zu prüfen (Entscheidungen, die Till bestätigen soll)

1. **Z2M-Namen bleiben Pflanzennamen.** Die Regel „`friendly_name` bleibt immer die IEEE-Adresse“ (Architektur-Spec 4.5) entfällt. Das Backend ordnet Nachrichten über `bridge/devices` (`friendly_name` ↔ IEEE) zu und folgt Umbenennungen. Grund: Die sechs Sensoren sind schon nach Pflanzen benannt; Self-Hosting-Nutzer benennen in Z2M ebenso.
2. **Z2M-Frontend bleibt im Heimnetz** unter Port 8080, aber mit `auth_token` (statt nur per SSH-Tunnel).
3. **Gateway registrieren:** Der Plattform-Admin fügt in der App das Gateway-Zertifikat (öffentlicher Teil) ein und wählt einen seiner Haushalte; das Backend liest Kennung und Ablaufdatum aus dem Zertifikat.
4. **Puffer für 72 h** statt 24 h (ein Wochenende ohne Internet); Kosten auf dem Pi: höchstens rund 60 MB RAM und 35 MB auf der SD-Karte, nur während eines Ausfalls.
5. **Owner sehen den Gateway-Status** ihres Haushalts unter „Mehr → Gateways“ (nur lesen).

## 1. Ziel

Nach Etappe 5 kommen die Nachrichten der sechs Pflanzensensoren (AOYAN AY-303Z) und der Lampe vom Pi verschlüsselt und gepuffert beim Produktions-Broker an. Das Backend kennt das Gateway, zeigt dessen Online-Status und warnt vor ablaufenden Zertifikaten. Staging, lokale Entwicklung und Stack-Test arbeiten mit einem Simulator, der dieselben Nachrichten erzeugt. Etappe 6 (Hardware, Geräte, Messwerte, Diagramme) setzt direkt darauf auf.

## 2. Aufteilung

Eine Spec, zwei Pläne in dieser Reihenfolge:

| Plan                   | Inhalt                                                                                                                                             | Sichtbares Ergebnis                                                                                                    |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 5a Broker und Gateways | PKI-Skripte, Produktions-Broker mit mTLS und ACL, Gateways im Backend (Registrierung, Status, Zertifikatsablauf), Simulator, Stack-Test mit Bridge | Ein simuliertes Gateway erscheint auf Staging „online“; der Produktions-Broker nimmt nur Zertifikate der eigenen CA an |
| 5b Pi anbinden         | Ordner `gateway/` (Compose, Mosquitto mit Bridge und Puffer, Z2M-Einstellungen), Härtung, Deploy vom Mac, Pi-Backups, Inbetriebnahme               | Die echten Sensoren melden sich über die Bridge in Produktion; das Gateway ist „online“                                |

5a fasst den Pi nicht an. 5b ändert den laufenden Pi und braucht vor der Ausführung Tills Freigabe; Kopplungen und Netzwerkschlüssel bleiben unverändert.

**Nicht in Etappe 5:** neuer Zigbee-Netzwerkschlüssel, Neukopplung und Austausch des CC2531 (später gemeinsam vor Ort, Entscheidung Till 2026-10-14); Hardware, Geräte und Messwerte im Backend (Etappe 6); Benachrichtigungen (Etappe 7); Gateways an fremden Brokern (Self-Hosting-Etappe).

## 3. Bridge und Puffer (aus Spike 2b, ADR-0020)

- Mosquitto 2.1.x gepinnt auf Pi und VPS (2.0.22 verliert Nachrichten bei gemischter QoS-Queue).
- Topic-Abbildung, Status-Topic, Keepalive und Puffergrößen wie ADR-0020; 72 h Puffer (`max_queued_messages 75000`, `max_queued_bytes 75497472`), `autosave_interval 300`, Speicherlimit des Pi-Brokers 256 MB.
- Z2M publiziert Gerätenachrichten mit QoS 1, wenn das echte Z2M die Geräte-Option `qos` unterstützt (in 5b am Gerät prüfen); sonst QoS 0 mit dem in ADR-0020 beschriebenen Restverlust.
- Backend-Client am VPS-Broker: `max_queued_messages 10000` für die Nachliefer-Spitze nach einem Ausfall.

## 4. PKI (5a)

Skripte in `infra/pki/` (Bash + OpenSSL), ausgeführt von Till auf dem Mac. Alle Schlüssel liegen außerhalb des Repos in `~/.smart-pki/` (Verzeichnis `700`, Dateien `600`); der CA-Schlüssel ist passphrase-geschützt und zusätzlich im Passwortmanager.

| Befehl                               | Wirkung                                                                                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pki.sh init-ca`                     | CA (ECDSA P-256, 10 Jahre); bricht ab, wenn schon eine CA existiert                                                                                     |
| `pki.sh issue-server <host>`         | Server-Zertifikat für den Broker (SAN = `<host>`, 2 Jahre)                                                                                              |
| `pki.sh issue-gateway [<gatewayId>]` | Gateway-Zertifikat, CN = Gateway-ID; ohne Angabe erzeugt das Skript eine ID `gw-` + 8 Zeichen `[a-z0-9]`; andere Muster und reservierte Namen abgelehnt |
| `pki.sh revoke <gatewayId>`          | Sperrt das Zertifikat, erzeugt die CRL neu                                                                                                              |
| `pki.sh crl`                         | Erneuert die CRL (gültig 365 Tage; eine abgelaufene CRL sperrt alle Gateways aus, daher Warnung 30 Tage vorher)                                         |
| `pki.sh status`                      | Listet Zertifikate mit Ablaufdatum und CRL-Gültigkeit                                                                                                   |

`infra/deploy/broker-certs.sh <staging|production>` (Till) kopiert `ca.crt`, `server.crt`, `server.key` und `crl.pem` in den Stack-Ordner auf dem VPS (`certs/`, nur für den Broker-Container lesbar) und lädt den Broker neu. `ca.crt` ist öffentlich und wird zusätzlich dem `api`-Container bereitgestellt (Prüfung bei der Registrierung).

## 5. Produktions-Broker (5a)

- Dasselbe Broker-Image für alle Umgebungen; der öffentliche Listener wird nur aktiv, wenn Zertifikate eingebunden sind (`MQTT_TLS=on` und vorhandene Dateien), sonst bleibt es beim internen Listener.
- **Listener 8883 (nur Produktion veröffentlicht):** `require_certificate true`, `use_identity_as_username true`, `cafile`, `certfile`, `keyfile`, `crlfile`, `tls_version tlsv1.2`, `max_connections 20`.
- **Listener 1883 (internes Docker-Netz):** Passwort für `smart-api` und `smart-simulator`.
- **ACL** (im Image, generisch): Gateways nach Spec 4.3 (`pattern … gw/%u/…`); `user smart-api` liest und schreibt `gw/#`; `user smart-simulator` schreibt nur unter seinem eigenen Präfix `gw/<SIMULATOR_GATEWAY_ID>/#` und liest dessen `set`/`bridge/request`.
- `queue_qos0_messages false`, `persistence true`, Healthcheck wie bisher.
- Compose: Produktion veröffentlicht `8883:8883`; Staging nicht. DNS `mqtt.smart.tillkosiol.de` deckt der vorhandene Eintrag `*.smart` ab.
- **Till (Root auf dem VPS fehlt Claude):** UFW-Regel für 8883 und Fail2ban-Filter für fehlgeschlagene TLS-Handshakes nach Runbook.

## 6. Gateways im Backend (5a)

### 6.1 Modell

Neues Core-Modul `core/gateways`. Tabelle `gateways`:

| Feld                       | Bedeutung                                                                               |
| -------------------------- | --------------------------------------------------------------------------------------- |
| `id`                       | Gateway-ID = Zertifikats-CN (`gw-…`)                                                    |
| `household_id`             | Haushalt (Pflicht)                                                                      |
| `name`                     | Anzeigename                                                                             |
| `kind`                     | `z2m`                                                                                   |
| `topic_prefix`             | `gw/<id>/z2m` (Self-Hosting-Leitplanke 1: Ingest und Befehle lesen das Präfix von hier) |
| `bridge_status`            | `online`/`offline`/`unknown` aus `gw/<id>/bridge/connection`                            |
| `z2m_status`               | `online`/`offline`/`unknown` aus `<prefix>/bridge/state`                                |
| `status_changed_at`        | Zeitpunkt des letzten Statuswechsels                                                    |
| `last_message_at`          | letzte Nachricht unter dem Präfix                                                       |
| `cert_fingerprint`         | SHA-256 des Zertifikats                                                                 |
| `cert_expires_at`          | Ablauf des Zertifikats                                                                  |
| `created_at`, `revoked_at` | Anlage, Sperrung in der App                                                             |

### 6.2 Registrierung und Sperrung

- „Mehr → Gateways“ zeigt Plattform-Admins alle Gateways ihrer Haushalte und das Formular „Gateway registrieren“: Name, Haushalt (einer, in dem der Admin owner ist), Zertifikat (PEM, öffentlicher Teil).
- Das Backend prüft: gültiges X.509, ausgestellt von der eingebundenen CA, CN nach Gateway-Muster und noch nicht registriert, nicht abgelaufen; übernimmt CN als ID, Ablauf und Fingerabdruck. Fehler: `gateway.invalidCertificate`, `gateway.exists`.
- „Sperren“ in der App setzt `revoked_at`; die App zeigt danach den Hinweis, das Zertifikat mit `pki.sh revoke` und `broker-certs.sh` auch am Broker zu sperren. Nachrichten eines gesperrten Gateways werden verworfen.
- Owner sehen unter „Mehr → Gateways“ die Gateways ihres Haushalts mit Status, letzter Nachricht und Zertifikatsablauf (nur lesen). Viewer und Member sehen den Eintrag nicht.

### 6.3 Status

- Der MQTT-Konsument abonniert `gw/+/bridge/connection` und `gw/+/z2m/bridge/state` (beide retained) sowie `gw/+/z2m/#` nur zum Fortschreiben von `last_message_at` (höchstens einmal pro Minute je Gateway, ohne Auswertung der Inhalte).
- Unbekannte oder gesperrte Gateways: einmal pro Stunde protokolliert, sonst verworfen.
- Statuswechsel erzeugen ein internes Ereignis `gateway.status-changed` (SSE und Benachrichtigung folgen in Etappe 6/7).
- Täglicher Job: Zertifikate, die in 30 Tagen ablaufen, und eine bald ablaufende CRL (Datum aus `GATEWAY_CRL_EXPIRES_AT`, von `broker-certs.sh` gesetzt) werden protokolliert und in der Gateway-Liste markiert.

## 7. Simulator (5a)

- Eigene kleine Anwendung `apps/gateway-simulator` (Node, TypeScript, ohne Nest), eigenes Image; läuft lokal, dauerhaft auf Staging und im Stack-Test.
- Verbindet sich als `smart-simulator` über 1883 und verhält sich wie ein Gateway mit Bridge: setzt `gw/<id>/bridge/connection` = `1` (retained, Last Will `0`), publiziert unter `gw/<id>/z2m/` wie Z2M: `bridge/state` (retained), `bridge/devices` (retained, Definitionen aus echten Geräten: sechs AY-303Z, eine IKEA LED1624G9; IEEE-Adressen und Namen erfunden), Gerätenachrichten mit `last_seen` (ISO 8601), `availability`.
- Werte verlaufen plausibel (Boden trocknet langsam aus, Batterie sinkt, ein Sensor geht zeitweise offline); die Lampe reagiert auf `set`.
- Intervalle per Umgebungsvariable (Standard 5 min, im Test Sekunden); deterministisch mit Startwert für Tests.

## 8. Pi anbinden (5b)

- **Ordner `gateway/`:** Compose für Mosquitto 2.1.x und Zigbee2MQTT (aktuelle 2.x-Version gepinnt), Mosquitto-Konfiguration nach ADR-0020 (Vorlage, Gateway-ID und Broker-Host als Platzhalter), Z2M-Überlagerung für `mqtt`, `advanced.last_seen: ISO_8601`, `availability.enabled: true`, `frontend.auth_token`. Netzwerkschlüssel, PAN-IDs und Geräteliste bleiben aus der bestehenden `configuration.yaml` erhalten.
- **Härtung:** Mosquitto nicht mehr im Heimnetz veröffentlicht (nur Docker-Netz), Passwort für Z2M; Z2M-Frontend mit Token; Images gepinnt; Log-Rotation; Speicherlimits; `systemd-timesyncd` geprüft.
- **Geheimnisse auf dem Pi:** `infra/deploy/provision-gateway.sh` (Till, vom Mac): erzeugt Mosquitto-Passwort und Frontend-Token, kopiert Gateway-Schlüssel und -Zertifikat aus `~/.smart-pki/` und die B2-Zugangsdaten für Backups auf den Pi (Dateien `600`). Nichts davon geht durch den Chat.
- **Deploy:** `pnpm gateway:deploy` vom Mac im Heimnetz (rsync + `docker compose up -d` per SSH), mit Prüfung, dass der Pi erreichbar und die Konfiguration gültig ist.
- **Umzug:** Das bestehende Setup (`/home/till/smart-home`) wird nach einer Sicherung seiner Daten gestoppt; der neue Stack übernimmt den Z2M-Datenordner. Rückweg: alten Stack wieder starten (im Runbook).
- **Backups:** nächtlich restic nach B2 (eigenes Repository-Präfix für den Pi): Z2M-Datenordner (enthält den Netzwerkschlüssel) und die Gateway-Konfiguration; Ping an healthchecks.io; Restore-Test im Runbook.
- **Inbetriebnahme:** Zertifikat ausstellen → in der App registrieren → `provision-gateway.sh` → `gateway:deploy` → Status „online“ in der App → Schreib-/Lesetest der ACL → QoS-Option des echten Z2M prüfen.

## 9. Tests

- **PKI:** Skripttests (wie `infra/deploy/test`): CA nur einmal, CN-Muster und reservierte Namen, Sperrung landet in der CRL, Rechte der Dateien.
- **Broker:** Stack-Test mit Wegwerf-CA: ein Pi-Broker-Container mit Bridge verbindet sich per mTLS; ohne Zertifikat, mit fremder CA und mit gesperrtem Zertifikat scheitert der Handshake; ACL verhindert das Schreiben unter fremdem Präfix (Prüfung über das Ausbleiben der Nachricht).
- **Backend:** Integrationstests für Registrierung (gültig, fremde CA, abgelaufen, falsches CN, doppelt), Status aus retained Nachrichten, gesperrte und unbekannte Gateways, Mandantentrennung (Owner sieht nur eigene Gateways), Zertifikatsjob.
- **Frontend:** Seite „Gateways“ für Admin und Owner, Formular und Fehlercodes in beiden Sprachen.
- **Simulator:** Unit-Tests für Nachrichtenform (gegen echte Z2M-Beispiele) und Werteverlauf; im Stack-Test meldet sich das simulierte Gateway „online“.
- **E2E:** Admin registriert das Gateway des Simulators per Zertifikat → Status „online“; Owner sieht es, Member nicht.
- **5b:** Skripttests für `provision-gateway.sh` und `gateway:deploy` (Stub-SSH), Konfigurations-Rendering; Inbetriebnahme-Checkliste vor Ort.

## 10. Betrieb und Doku

- Neues Runbook `docs/runbooks/gateway.md`: PKI einrichten, Gateway ausstellen/registrieren/sperren, Zertifikate und CRL erneuern, UFW/Fail2ban, Pi-Deploy, Umzug und Rückweg, Pi-Restore.
- Architektur-Spec anpassen: 4.3 (Mosquitto 2.1.x, Simulator-Benutzer, `max_connections`), 4.5 (Namensregel entfällt, Frontend im Heimnetz mit Token, Puffer 72 h), 8.4 (`gateways` wie 6.1), ADR-Tabelle um ADR-0020.

## 11. Nicht-Ziele

Neukopplung, Netzwerkschlüssel, Koordinator-Tausch; Hardware, Geräte, Messwerte, Befehle (Etappe 6); Benachrichtigungen (Etappe 7); WireGuard vor dem Broker; eine zweite Bridge vom Pi zu Staging; Gateways an fremden Brokern.
