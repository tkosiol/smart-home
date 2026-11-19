# Home-Assistant-Adapter – Design

- Status: angenommen (Till: Ansatz A, autonome Umsetzung, 2026-11-19)
- Baut auf: ADR-0021, `docs/superpowers/specs/2026-11-18-adapter-schicht-design.md`

## 1. Ziel

Home Assistant (HA) wird die zweite Gateway-Art (`ha`). Erster Nutzen: Tills Yeelight-Lampen, die HA lokal steuert, erscheinen in der App mit Zustand, Helligkeit und Farbtemperatur und lassen sich als Geräte hinzufügen. Befehle folgen in 6c-3 für Z2M und HA zugleich.

Erfolgskriterien:

- Eine HA-Installation meldet über eine eigene, schlanke Integration (`smart_bridge`) ihre Geräte, deren Zustände und ihren eigenen Status an die Plattform; der Backend-Adapter `ha` übersetzt sie ins Vokabular. Am Kern ändert sich nichts außer der neuen Art.
- Auf Tills Pi läuft HA als optionaler Dienst des Gateway-Pakets; Zigbee2MQTT, Mosquitto und die Bridge bleiben unverändert.
- Die Integration verbindet sich **direkt** per mTLS mit dem Plattform-Broker, so wie es später fremde HA-Installationen ohne Pi tun.
- Beim Registrieren eines Gateways wählt man in der App die Art.

**Nicht in dieser Etappe:** Befehle (6c-3, hier nur die Vorgabe, Abschnitt 8), Installation über HACS und Einrichtung per Kopplungscode für fremde Nutzer (Abschnitt 9), Szenen, Automationen, Bereiche/Räume als eigenes Konzept, weitere HA-Domänen außer den in 5.2 genannten.

## 2. Begriffe

- **HA-Gateway:** eine HA-Installation mit eigener Gateway-ID, eigenem Zertifikat (CN = Gateway-ID) und der Art `ha`. Auf Tills Pi gibt es damit zwei Gateways: das bestehende Z2M-Gateway und das neue HA-Gateway.
- **Gerät (HA):** ein Eintrag der HA-Geräteregistrierung (`device_id`, 32 Hex-Zeichen). Wird zur Hardware der Plattform (`externalId` = `address` = `device_id`).
- **Entität:** ein Eintrag der HA-Entitätsregistrierung mit `device_id`. Wird zu höchstens einer Fähigkeit-Gruppe der Hardware (Lampe: bis zu drei Fähigkeiten).
- **Schnappschuss:** der vollständige Zustand aller weitergereichten Entitäten eines Geräts in einer Nachricht.

## 3. Architektur

```
Yeelight ⇄ HA (yeelight, local push) ── smart_bridge ──mTLS──▶ Plattform-Broker ──▶ GatewayIngest ──▶ HaAdapter
                                          gw/<id>/ha/…, gw/<id>/bridge/connection
```

- **Direktverbindung statt Bridge:** Die Integration bringt ihren eigenen MQTT-Client (paho-mqtt 2.1.0, im HA-Image enthalten) mit und spricht den Plattform-Broker auf 8883 an. Der lokale Mosquitto puffert für HA nichts; das ist unnötig, weil jede Nachricht der Integration retained ist und den vollständigen Stand trägt (nach einer Unterbrechung zählt der aktuelle Zustand, nicht die Zwischenschritte). So ist der Weg auf dem Pi derselbe wie später bei fremden Installationen, und das Gateway-Paket bleibt unberührt bis auf den Dienst selbst.
- **Eigene Integration statt HA-Bordmittel** (`mqtt_statestream`): HA kann nur mit einem MQTT-Broker verbunden sein, die Bordmittel liefern keine Geräteangaben, und Befehle über Automationen ließen sich schlecht absichern. Die Integration bleibt **dumm**: Sie reicht Registrierung und Zustände unverändert weiter; Auswahl der Fähigkeiten, Einheiten, Vokabular und Verfügbarkeit entscheidet der Adapter im Backend (ADR-0021).
- **Ein HA-Gateway = eine Verbindung = eine Art.** Das Datenmodell bleibt, wie es ist (Gateway = Verbindung + Präfix + Art).

## 4. Die Integration `smart_bridge` (`integrations/home-assistant/`)

Python (wie HA: 3.14), keine Abhängigkeit außer HA selbst und `paho-mqtt==2.1.0` (von HA gepinnt, im Image vorhanden; `manifest.json` nennt sie, damit HA nichts nachinstalliert). Konfigurationsschema mit `probatio` und `homeassistant.helpers.config_validation` (HA hat `voluptuous` 2026 durch `probatio` ersetzt).

```
integrations/home-assistant/
  custom_components/smart_bridge/
    __init__.py      # CONFIG_SCHEMA, async_setup: startet/stoppt die Bridge
    manifest.json    # domain smart_bridge, version, requirements, iot_class local_push
    protocol.py      # rein (ohne HA-Import): Topics, Auswahl, Nutzlasten, Größengrenzen
    collector.py     # liest Geräte-/Entitätsregistrierung und Zustände → Eingaben für protocol.py
    connection.py    # paho-Client: mTLS, Will, Wiederverbindung, publish
    bridge.py        # verbindet alles: Start, Ereignisse, Entprellen, Stopp
  tests/             # pytest (pytest-homeassistant-custom-component)
  test/run-tests.sh  # ruff + pytest im Container, danach Docker-Test mit echtem HA-Image
  requirements-test.txt
  README.md
```

### 4.1 Konfiguration (YAML)

```yaml
smart_bridge:
  gateway_id: gw-abcdefgh # Muster gw-[a-z0-9]{8}
  broker_host: broker.example.org
  broker_port: 8883
  ca_file: /smart/secrets/ca.crt
  cert_file: /smart/secrets/gateway.crt
  key_file: /smart/secrets/gateway.key
```

Auf dem Pi kommen die Werte per `!env_var` aus der Umgebung des Containers (Abschnitt 7). Eine Einrichtung über die Oberfläche (Config Flow) kommt erst mit dem Kopplungscode (Abschnitt 9).

### 4.2 Verbindung

- Client-ID `<gateway_id>-ha` (die Bridge des Pi nutzt `<id>-bridge`; gleiche IDs würden sich gegenseitig trennen), MQTT 3.1.1, TLS 1.2 mit Client-Zertifikat, Keepalive 30 s.
- **Will:** `gw/<id>/bridge/connection` = `0`, retained, QoS 1. Nach jedem Verbindungsaufbau `1` retained. Vor einem geordneten Stopp: `status` = `offline` und `bridge/connection` = `0`, dann trennen. Damit gilt für den Kern dasselbe wie bei der Mosquitto-Bridge (`1`/`0`).
- Wiederverbindung mit wachsender Pause (1 s bis 60 s, paho `reconnect_delay_set`). Nach jedem Verbindungsaufbau veröffentlicht die Bridge den vollständigen Stand neu (Status, Geräteliste, alle Schnappschüsse).
- Blockierendes (TLS-Kontext laden, `connect`) läuft im Executor (`hass.async_add_executor_job`); paho läuft in seinem eigenen Thread (`loop_start`), Rückrufe gehen per `hass.loop.call_soon_threadsafe` in die Ereignisschleife.
- Alle Veröffentlichungen: QoS 1, retained.

### 4.3 Topics und Nutzlasten (Protokoll v1)

Unter `gw/<id>/ha/`:

| Topic                | Nutzlast                                                                                                                                      |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `status`             | `online` / `offline` (Text). `online` erst, wenn HA gestartet ist (`async_at_started`) und die Geräteliste veröffentlicht wurde.              |
| `devices`            | `{"v":1,"devices":[Gerät…]}`                                                                                                                  |
| `device/<device_id>` | `{"v":1,"entities":{"<entity_id>":{"state":"on","attributes":{…},"last_updated":"2026-11-19T18:03:21.123456+00:00"}}}`; leer = Gerät entfernt |

Gerät: `{"id","name","manufacturer","model","area","entities":[Entität…]}`. `name` ist `name_by_user` oder `name` der Registrierung (kann `null` sein), `area` der Name des Bereichs oder `null`.

Entität: `{"entity_id","domain","device_class","name","unit","capabilities","entity_category"}` aus der Entitätsregistrierung (`device_class` = `device_class` oder `original_device_class`; `name` = `name` oder `original_name`; `unit` = `unit_of_measurement`; `capabilities` wie registriert, bei Lampen z. B. `supported_color_modes`, `min_color_temp_kelvin`, `max_color_temp_kelvin`).

Die Integration wählt **nur grob** aus (damit Neues im Backend ohne Update der Integration geht, aber kein Rauschen den Broker füllt):

- Domänen `light`, `switch`, `sensor`, `binary_sensor` (Konstante; eine neue Domäne ist ein Update der Integration).
- Entität mit `device_id`, nicht deaktiviert, `entity_category` nicht `config`.
- Gerät nicht deaktiviert und mit mindestens einer solchen Entität.

`attributes` werden unverändert weitergereicht. Ist ein Schnappschuss größer als 60 KiB, werden die Attribute auf skalare Werte gekürzt (Zahl, Boolean, `null`, Text bis 256 Zeichen); bleibt er zu groß, wird er nicht veröffentlicht (Warnung im HA-Log). Die Geräteliste darf bis 4 MiB groß sein.

### 4.4 Ablauf

- **Start** (`async_at_started`): Verbindung aufbauen; nach dem Verbindungsaufbau Geräteliste, alle Schnappschüsse, dann `status` = `online`.
- **Registrierung ändert sich** (`device_registry_updated`, `entity_registry_updated`): nach 2 s Ruhe (entprellt) Geräteliste und Schnappschüsse neu; für Geräte, die nicht mehr dabei sind, eine leere retained Nachricht auf ihr Topic (löscht den Retain-Stand).
- **Zustand ändert sich** (`async_track_state_change_event` für die gewählten Entitäten, bei jeder Änderung der Liste neu gesetzt): Schnappschuss des Geräts, je Gerät höchstens einer pro Sekunde (der letzte Stand gewinnt).
- **Stopp** (`EVENT_HOMEASSISTANT_STOP`): `offline`, `0`, trennen (höchstens 5 s).
- Getrennt vom Broker: Veröffentlichungen werden verworfen (nicht gepuffert); nach der Wiederverbindung kommt der vollständige Stand.

### 4.5 Grenzen

Nutzlasten werden nie geloggt. Der Broker hat 20 Verbindungen auf 8883 (`max_connections`); das HA-Gateway braucht eine davon. Keine Befehle in dieser Etappe: Die Integration abonniert nichts.

## 5. Der Backend-Adapter `ha` (`apps/backend/src/adapters/ha/`)

Gleiche Form wie der Z2M-Adapter: `ha.adapter.ts`, `devices.ts` (Geräteliste → `hardware.listed`), `entities.ts` (Entitäten → Fähigkeiten), `decode.ts`, `ha-adapter.module.ts`, `index.ts`, Specs je Datei. Registriert in `app.module.ts`.

### 5.1 Topics

- `serviceStatusTopic` = `status`; `parseServiceStatus`: `online`/`offline` als Text (höchstens 1 KiB), sonst nichts.
- `classify`: `devices` → 4 MiB; `device/<id>` mit `<id>` aus `[A-Za-z0-9_-]{1,64}` → 64 KiB; alles andere (auch `status`, künftige Befehls-Topics) → verworfen.
- `translate`:
  - `devices`: gültiges JSON mit `v` = 1 und Liste → `hardware.listed`; sonst nichts.
  - `device/<id>`: leere Nutzlast → nichts. Ungültiges JSON oder falsches `v` → nur `activity`. Sonst `hardware.report` (Ref `{address: id}`, `native` = Schnappschuss), `hardware.availability` (5.4) und `activity`.

### 5.2 Fähigkeiten aus Entitäten

Je Gerät werden die Entitäten nach `entity_id` sortiert; jede gültige Entität ergibt Fähigkeiten nach dieser Tabelle. `native` der Fähigkeit: `{ entity, source, unit? }`.

| Entität                                                              | Schlüssel (Vokabular)                                                                                        | `source`     |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------ |
| `light`                                                              | `state` (schreibbar)                                                                                         | `onoff`      |
| `light` mit einem Farbmodus außer `onoff` in `supported_color_modes` | `brightness` (%, schreibbar, Schritt 1)                                                                      | `brightness` |
| `light` mit `color_temp` in `supported_color_modes`                  | `color_temp` (K, schreibbar; Bereich aus `min/max_color_temp_kelvin`, auf das Vokabular 1000–10000 begrenzt) | `kelvin`     |
| `switch`                                                             | `state` (schreibbar)                                                                                         | `onoff`      |
| `sensor`, `device_class` `temperature`                               | `temperature` (°C)                                                                                           | `numeric`    |
| `sensor`, `humidity`                                                 | `humidity`                                                                                                   | `numeric`    |
| `sensor`, `moisture`                                                 | `soil_moisture`                                                                                              | `numeric`    |
| `sensor`, `battery`                                                  | `battery`                                                                                                    | `numeric`    |
| `binary_sensor`, `door`, `window`, `opening`, `garage_door`          | `contact` (`true` = geschlossen)                                                                             | `closed`     |

- Andere Entitäten werden **nicht** zu Fähigkeiten (anders als bei Z2M kein Durchreichen: HA-Entitäten tragen frei gewählte Namen, das gäbe Rauschen). Sie bleiben im `native` der Hardware und können später neu abgeleitet werden.
- **Kollision** (zwei Entitäten eines Geräts beanspruchen denselben Schlüssel): Die erste nach Sortierung erhält ihn, die weiteren `<key>_2`, `<key>_3`, … (gültig nach `CAPABILITY_KEY_PATTERN`).
- `numeric` merkt sich die Einheit der Registrierung (`unit`): Temperatur in `°F` und `K` wird beim Dekodieren nach °C umgerechnet; eine unbekannte Temperatureinheit macht die Entität unbrauchbar (keine Fähigkeit). Prozentwerte brauchen `%`.
- Hardware: `externalId` = `address` = Geräte-ID, `name` = `name` des Geräts, sonst Name der ersten Entität, sonst `model`, sonst die Geräte-ID; `vendor` = `manufacturer` oder `''`, `model` = `model` oder `''`, `description` = `null`, `setupState` = `ready`, `native` = das Gerät wie gemeldet.

### 5.3 `decodeReport`

Je Fähigkeit wird die Entität aus `native.entity` im Schnappschuss gesucht; fehlt sie oder ist ihr Zustand `unavailable`/`unknown`, entfällt der Wert.

- `onoff`: `on` → `true`, `off` → `false`, sonst nichts.
- `brightness`: Attribut `brightness` (0–255) → `round(raw / 255 · 100)`, ein Rohwert > 0 ergibt mindestens 1. Ist die Lampe aus (`brightness` = `null`), entfällt der Wert.
- `kelvin`: Attribut `color_temp_kelvin`, gerundet, auf das Vokabular begrenzt; `null` → nichts.
- `numeric`: Zustand als endliche Zahl, Einheit umgerechnet (°F: `(x − 32) · 5/9`, K: `x − 273.15`, auf zwei Stellen gerundet).
- `closed`: `off` → `true`, `on` → `false`.
- `measuredAt`: das jüngste gültige `last_updated` (ISO mit Zone) der Entitäten im Schnappschuss; ohne gültiges → `undefined`. Der Kern prüft die Plausibilität wie bei Z2M.

### 5.4 Verfügbarkeit

Aus jedem Schnappschuss mit mindestens einer Entität: alle Entitäten `unavailable` → `offline`, sonst `online`. HA meldet so, wenn eine Yeelight vom Strom getrennt ist.

## 6. Kern, Contracts, Broker, Frontend

- **Contracts:** `GATEWAY_KINDS = ['z2m', 'ha']`.
- **Broker-ACL** (`infra/broker/acl`): `pattern write gw/%u/ha/#`. Leserechte bekommt die Art erst mit den Befehlen.
- **Frontend:** Übersetzung `gateways.kind.ha` = „Home Assistant“; das Registrierungsformular bekommt eine Auswahl der Art (Standard Zigbee2MQTT), die `kind` mitsendet. Sonst keine Änderung: Status, „Neu erkannt“, Geräte und Werte sind schon neutral.
- **Kern:** keine Änderung. Das ist der Prüfstein der Adapter-Schicht.

## 7. Pi: Gateway-Paket

- **Dienst `homeassistant`** in `gateway/compose.yaml`: Image `ghcr.io/home-assistant/home-assistant:2026.11.0` (gepinnt, arm64), Profil `ha`, `network_mode: host` (Yeelight- und andere Erkennung brauchen Multicast), `restart: unless-stopped`, `mem_limit: 512m`, Log-Rotation wie die übrigen Dienste. Einbindungen:
  - `./homeassistant-data:/config` (HA-Daten: Benutzer, eingerichtete Integrationen; nie vom Deploy angefasst),
  - `./homeassistant/configuration.yaml:/config/configuration.yaml:ro`,
  - `./homeassistant/custom_components/smart_bridge:/config/custom_components/smart_bridge:ro`,
  - `./secrets/ha:/smart/secrets:ro`.
    Umgebung: `SMART_HA_GATEWAY_ID` (aus `secrets/ha/ha.env`), `BROKER_HOST`, `BROKER_PORT` (aus `gateway.env`), `TZ`.
- **Schlanke Konfiguration** (`gateway/homeassistant/configuration.yaml`): kein `default_config`, sondern nur `http`, `frontend`, `config`, `person`, `network`, `ssdp`, `zeroconf`, `dhcp`, `logger` (Standard `warning`), `recorder` (`purge_keep_days: 1`, `commit_interval: 60`, schont die SD-Karte) und `smart_bridge`. Die HA-Oberfläche ist im Heimnetz auf Port 8123 erreichbar (HA-eigene Anmeldung), nie ins Internet weiterleiten.
- **Gemessen** am Pi (3B+, 1 GB, 2026-11-19, diese Konfiguration ohne `smart_bridge`): HA belegt nach dem Start rund 300 MB RSS, verfügbar blieben rund 360 MB. Der Kernel des Pi startet mit `cgroup_disable=memory`: **`mem_limit` wirkt dort nicht**, auch nicht das bestehende von Zigbee2MQTT. Das Runbook beschreibt, wie man die Speicher-Cgroup einschaltet (`cgroup_enable=memory` in `/boot/firmware/cmdline.txt`, Neustart); bis dahin entscheidet bei Speichernot der OOM-Killer des Kernels, und `unless-stopped` startet den Dienst neu.
- **Deploy** (`gateway/deploy.sh`, `start.sh`): kopiert zusätzlich `integrations/home-assistant/custom_components/smart_bridge/` nach `homeassistant/custom_components/smart_bridge/` (mit `--delete`, keine alten Dateien), schließt `homeassistant-data/` vom Kopieren aus und startet das Profil `ha` genau dann, wenn `secrets/ha/ha.env` existiert. Ohne HA-Secrets verhält sich alles wie bisher. Nach dem Start wartet es, bis HA auf 8123 antwortet (höchstens 10 min, der Pi braucht beim ersten Start lange), und meldet das Ergebnis; ein Fehler von HA bricht den Deploy nicht ab und rollt nichts zurück (Z2M läuft weiter).
- **Backup:** `homeassistant-data/` kommt ins nächtliche restic-Backup, ohne `home-assistant_v2.db*` (Verlauf, die Plattform hat ihn) und `*.log*`; der Restore-Test prüft zusätzlich `.storage/core.config_entries`, falls HA eingerichtet ist.
- **Secrets:** neues Skript `infra/deploy/provision-ha.sh <ha-gateway-id> [--force]` (Till führt es aus, Muster wie `provision-gateway.sh`: eine SSH-Sitzung, tar über stdin, root 700/600). Schreibt `secrets/ha/ha.env` (`SMART_HA_GATEWAY_ID`), `secrets/ha/ca.crt`, `gateway.crt`, `gateway.key` aus `~/.smart-pki`. Weigert sich, wenn die ID der des Z2M-Gateways (`gateway.env`) gleicht.
- **Runbook** (`docs/runbooks/gateway.md`, neuer Abschnitt „Home Assistant auf dem Pi“): Zertifikat ausstellen (`pki.sh issue-gateway`), in der App mit Art Home Assistant registrieren, `provision-ha.sh`, `gateway:deploy`, HA-Ersteinrichtung auf `http://<pi>:8123`, Yeelight: in der Yeelight-App „LAN-Steuerung“ je Lampe einschalten, in HA die Integration Yeelight hinzufügen, in der App „Neu erkannt“ prüfen. Optional: Speicher-Cgroup einschalten.

## 8. Vorgabe für 6c-3 (Befehle)

- Topic `gw/<id>/ha/command` (nicht retained, QoS 1), Nutzlast `{"v":1,"id":"<uuid>","entity_id":"light.x","service":"turn_on","data":{"brightness_pct":40,"color_temp_kelvin":3000}}`. `encodeCommand` des Adapters erzeugt sie aus Fähigkeit und kanonischem Wert (`state` → `turn_on`/`turn_off`, `brightness` → `brightness_pct`, `color_temp` → `color_temp_kelvin`).
- Die Integration führt **nur** `light.turn_on`/`turn_off` und `switch.turn_on`/`turn_off` mit den Daten-Schlüsseln `brightness_pct` und `color_temp_kelvin` aus, und nur für Entitäten, die sie selbst meldet. Alles andere verwirft sie (Warnung ohne Nutzlast).
- Die Bestätigung bleibt im Kern: Der nächste Schnappschuss trägt den Sollwert.
- ACL: `pattern read gw/%u/ha/command`.

## 9. Leitplanken für Wachstum (nicht gebaut)

- **Fremde Installationen:** Die Integration wird über HACS installierbar (eigenes Repository oder Release-Artefakt aus diesem Repo) und bekommt einen Config Flow: Kopplungscode aus der App → Zertifikat (CSR in HA erzeugt, signiert von der Plattform) → Gateway angelegt. Der private Schlüssel verlässt HA nie.
- **Broker:** `max_connections 20` auf 8883 reicht für eine Handvoll Gateways; vor fremden Nutzern anheben und messen.
- **Auswahl:** Bei vielen Entitäten könnte die Plattform der Integration retained eine Liste der gewünschten Geräte schicken, damit nur deren Zustände fließen.
- **Neu ableiten:** Weitere Domänen oder Geräteklassen (z. B. `cover`, `climate`, Leistung) aus dem gespeicherten `native` ableiten, ohne Update der Integration für bereits weitergereichte Domänen.

## 10. Tests

- **Integration, rein (pytest):** `protocol.py`: Auswahl (Domänen, deaktiviert, `config`-Kategorie, ohne Gerät), Nutzlasten, Kürzung über 60 KiB, Topics.
- **Integration mit HA (pytest-homeassistant-custom-component, `hass`-Fixture, Fake-Verbindung):** Start veröffentlicht Liste, Schnappschüsse, `online`; Zustandsänderung → Schnappschuss (entprellt je Gerät); Registrierungsänderung → neue Liste und Löschen entfernter Geräte; Stopp → `offline`/`0`; Wiederverbindung → vollständiger Stand. Das Test-Paket ist an die nächste verfügbare HA-Version gebunden (heute 2026.10.4); der Docker-Test unten prüft das gepinnte Image.
- **Integration im echten Image (Docker, `test/run-tests.sh`):** HA 2026.11.0 mit `smart_bridge` und einer Demo-Lampe, Broker-Image aus `infra/broker` mit Wegwerf-PKI und echter ACL: `bridge/connection` = `1`, `status` = `online`, `devices` mit der Lampe, ihr Schnappschuss kommen an; nach `docker stop` `offline` und `0`. Beweist Import, TLS, ACL und Python-Version des Images.
- **Backend-Adapter (Unit):** `classify`, `translate` je Topic, Fähigkeiten-Tabelle mit allen Zeilen, Kollision, Einheiten, `decodeReport` (an/aus, Helligkeit 0/1/255/aus, Kelvin begrenzt, °F, `unavailable`, Zeit), Verfügbarkeit, `parseServiceStatus`.
- **Backend (Integrationstest, Testcontainers):** HA-Gateway registrieren, Nachrichten im Protokoll v1 über den echten Ingest: Hardware erscheint, Gerät hinzufügen, Messwerte, Verfügbarkeit, Service-Status, Entfernen eines Geräts. Nutzlasten aus gemeinsamen Beispieldateien (`integrations/home-assistant/fixtures/`), die auch die pytest-Tests der Integration gegen ihre Ausgabe prüfen: so bleiben beide Seiten beim selben Protokoll.
- **Gateway-Paket:** `gateway-test.sh` prüft, dass ohne `secrets/ha` kein HA startet (Profil); `deploy-tests.sh` prüft Kopie der Integration, Profil-Schalter und Ausschluss von `homeassistant-data`; `backup-tests.sh` den Einschluss/Ausschluss; Test von `provision-ha.sh` in `infra/deploy/test`.
- **Frontend:** Auswahl der Art im Registrierungsformular sendet `kind`; Übersetzung vorhanden.
- **CI:** neue Suite `ops (ha-integration)` (`bash integrations/home-assistant/test/run-tests.sh`); Dependabot für `pip` im Ordner der Integration und für das HA-Image (`docker`, `gateway/`).

## 11. Entscheidungen (autonom getroffen, zur Prüfung)

1. **Eigene Integration mit Direktverbindung** (Ansatz A, mit Till besprochen) statt Bridge über den lokalen Mosquitto: gleicher Weg wie später bei fremden Installationen; kein Puffer nötig, weil jede Nachricht retained den vollständigen Stand trägt. Kosten bei Irrtum: Bridge-Abschnitt in `mosquitto.conf.template` nachrüsten, die Integration spräche dann lokal.
2. **Ein HA = ein eigenes Gateway** (eigene ID, eigenes Zertifikat) statt mehrerer Arten je Gateway: kein Umbau des Datenmodells. Kosten: auf dem Pi zwei Zertifikate.
3. **Schnappschuss je Gerät** statt einer Nachricht je Entität: Der zustandslose Adapter kann Verfügbarkeit und Zeit aus einer Nachricht ableiten. Kosten: bei Geräten mit vielen Entitäten mehr Bytes je Änderung.
4. **Kein Durchreichen unbekannter Entitäten** (anders als Z2M): HA-Namen sind frei; sie bleiben im `native`. Kosten: Neue Arten von Werten brauchen eine Zeile in der Tabelle 5.2.
5. **Grobe Auswahl in der Integration** (vier Domänen): verhindert Rauschen; eine neue Domäne ist ein Update der Integration.
6. **HA-Version 2026.11.0** (älteste der aktuellen Reihe, mindestens zwei Wochen alt); Tests mit `pytest-homeassistant-custom-component` 0.13.375 (HA 2026.10.4), weil es für 2026.11 noch keine Ausgabe gibt.
7. **HA auf dem Pi trotz 1 GB:** gemessen 300 MB, schlanke Konfiguration. Kosten bei Irrtum: HA auf anderer Hardware betreiben; die Integration ist davon unabhängig.
8. **Python als zweite Sprache**, nur in `integrations/home-assistant/`, mit `ruff` (Lint und Format) und pytest, ausgeführt in Containern (keine Python-Installation auf dem Mac nötig).
