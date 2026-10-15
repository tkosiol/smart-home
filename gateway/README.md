# Gateway (Raspberry Pi)

Der Ordner enthält alles, was auf einem Gateway läuft: Mosquitto (lokaler Broker mit Bridge zum Plattform-Broker, ADR-0020) und Zigbee2MQTT, beide mit gepinnten Images. Er ist allgemein gehalten: Gateway-ID, Broker-Adresse und Zugangsdaten stehen ausschließlich in `secrets/` auf dem Gateway, nie im Repository. Auf dem Pi liegt der Ordner unter `/srv/smart-gateway`.

| Datei                     | Zweck                                                                                                             |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `compose.yaml`            | Mosquitto 2.1.2 und Zigbee2MQTT 2.14.2, Speicherlimits, Log-Rotation                                              |
| `mosquitto.conf.template` | Mosquitto-Konfiguration nach ADR-0020 mit den Platzhaltern `{{GATEWAY_ID}}`, `{{BROKER_HOST}}`, `{{BROKER_PORT}}` |
| `render.sh`               | prüft `secrets/gateway.env`, füllt die Vorlage, schreibt `run/mosquitto.conf` (Modus 600, atomar)                 |
| `mosquitto-entrypoint.sh` | kopiert die Geheimnisse beim Start für den Mosquitto-Benutzer lesbar in ein tmpfs und erzeugt die lokale ACL      |
| `test/gateway-test.sh`    | Docker-Test des Pakets (`bash gateway/test/gateway-test.sh`, braucht Docker und OpenSSL 3)                        |

## Dateien in `secrets/` (root `700`, Dateien `600`)

| Datei                                  | Inhalt                                                                                                                                                                |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gateway.env`                          | `GATEWAY_ID` (`gw-[a-z0-9]{8}`), `BROKER_HOST`, `BROKER_PORT`, `Z2M_SERIAL_DEVICE` (Pfad des Adapters auf dem Host)                                                   |
| `z2m.env`                              | `ZIGBEE2MQTT_CONFIG_MQTT_USER`, `ZIGBEE2MQTT_CONFIG_MQTT_PASSWORD`, `ZIGBEE2MQTT_CONFIG_FRONTEND_AUTH_TOKEN`                                                          |
| `passwd`                               | Passwortdatei des lokalen Brokers (Benutzer wie in `z2m.env`, erzeugt mit `mosquitto_passwd`)                                                                         |
| `ca.crt`, `gateway.crt`, `gateway.key` | CA und Gateway-Zertifikat für die mTLS-Bridge                                                                                                                         |
| `backup.env`                           | `B2_ENDPOINT` (Host ohne `https://`), `B2_BUCKET`, `B2_KEY_ID`, `B2_APP_KEY`, `RESTIC_PASSWORD`, `HC_BACKUP_URL` (für das Backup des Pi, Schlüssel `smart-pi-restic`) |

`infra/deploy/provision-gateway.sh` (`SMART_PI=<user@pi-host> infra/deploy/provision-gateway.sh <gateway-id> [--force]`, läuft auf dem Mac im Heimnetz) schreibt alle diese Dateien in einer SSH-Sitzung als `sudo -n` (der Betreiber-Benutzer braucht passwortloses `sudo` und Docker; die Passwortdatei hasht das gepinnte Mosquitto-Image mit `mosquitto_passwd -U`, das Passwort steht nie in einer Kommandozeile). Zertifikat und Schlüssel kommen aus `~/.smart-pki` (`pki.sh issue-gateway`). Z2M-Passwort und Frontend-Token werden erzeugt und nicht ausgegeben (`sudo cat /srv/smart-gateway/secrets/z2m.env`); `--force` behält sie.

Die `.env`-Dateien sind einfache `KEY=Wert`-Zeilen: keine Anführungszeichen, kein `$` im Wert (Compose liest sie mit Interpolation). `render.sh` liest `gateway.env` nur zeilenweise und führt nichts davon aus; es läuft als root.

## Ablauf

```sh
sudo ./render.sh                                          # schreibt run/mosquitto.conf, bricht bei ungültigen Werten ab
sudo docker compose --env-file secrets/gateway.env up -d  # Mosquitto, dann Zigbee2MQTT
```

`SMART_GATEWAY_DIR` verlegt das Verzeichnis (Standard `/srv/smart-gateway`), nur für Tests.

## Entscheidungen und Befunde (gemessen mit den gepinnten Images)

- **Geheimnisse und Rechte:** Mosquitto liest Passwortdatei und Bridge-Schlüssel erst nach dem Wechsel auf den Benutzer `mosquitto` (UID 1883); eine root-eigene Datei mit Modus 600 scheitert mit `Unable to open pwfile`. `mosquitto-entrypoint.sh` kopiert die vier Dateien deshalb aus `secrets/` (nur lesend eingebunden) in ein tmpfs, das dem Benutzer gehört. Auf der SD-Karte bleiben sie root-eigen mit 600. `run/mosquitto.conf` liest Mosquitto noch als root. **Healthcheck ohne Geheimnis:** der Entrypoint fügt der Passwortkopie im tmpfs den Benutzer `health` mit öffentlichem Passwort hinzu und schreibt eine ACL: alle Benutzer der `passwd` (Zigbee2MQTT) dürfen alles, `health` nur `$SYS/broker/uptime` lesen. So steht kein Geheimnis in `docker inspect` oder `ps`. **`render.sh` bricht ab**, wenn `z2m.env` fehlt oder `ZIGBEE2MQTT_CONFIG_FRONTEND_AUTH_TOKEN` leer ist (das Frontend wäre sonst offen). **Nach jedem `render.sh` Mosquitto neu erzeugen** (`docker compose --env-file secrets/gateway.env up -d --force-recreate mosquitto`): `render.sh` ersetzt die Datei (neuer Inode), die Einzeldatei-Einbindung zeigt sonst weiter auf die alte.
- **Zeitzone:** Zigbee2MQTT läuft mit `TZ=Europe/Berlin`; `TZ` in der Umgebung von `docker compose` (oder in `secrets/gateway.env`) überschreibt das (`TZ: ${TZ:-Europe/Berlin}`).
- **Netz:** `gateway` ist ein gewöhnliches Bridge-Netz und kein `internal: true`: die Bridge braucht den Weg ins Internet, und Docker veröffentlicht keine Ports aus internen Netzen. Mosquitto veröffentlicht keinen Port; nur das Z2M-Frontend (8080, im Heimnetz, mit `auth_token`) ist erreichbar.
- **Z2M-Einstellungen per Umgebung:** Die Variablen heißen `ZIGBEE2MQTT_CONFIG_<PFAD>` (Großbuchstaben, `_` statt `.`), z. B. `…_MQTT_SERVER`, `…_MQTT_USER`, `…_MQTT_PASSWORD`, `…_FRONTEND_AUTH_TOKEN`, `…_ADVANCED_LAST_SEEN`, `…_AVAILABILITY_ENABLED`, `…_SERIAL_PORT`. Z2M 2.x hat das Frontend standardmäßig **aus**; deshalb setzt `compose.yaml` zusätzlich `…_FRONTEND_ENABLED=true` und `…_FRONTEND_PORT=8080`. Den Adapter reicht Compose immer als `/dev/zigbee` durch und setzt `…_SERIAL_PORT=/dev/zigbee`, so hängt der Start nicht davon ab, wie das alte Setup den Pfad genannt hat.
- **Z2M schreibt die Werte in die `configuration.yaml`:** Z2M 2.14.2 wendet die Variablen bei jedem Start an **und schreibt das Ergebnis zurück** (`onboard()` ruft `settings.write()`). Passwort und Token stehen danach im Klartext in `zigbee2mqtt-data/configuration.yaml`, Kommentare der Datei gehen verloren, Geräte, Namen, Kanal und Schlüssel bleiben unverändert (der Test prüft das), ein zweiter Start mit denselben Werten ändert die Datei nicht mehr (Prüfsumme). Folgen: Der Ordner `zigbee2mqtt-data` ist nur für root lesbar zu halten (Modus 700, `configuration.yaml` 600), und beim Umzug wird der Datenordner kopiert, nie die Datei des alten Stacks verändert.

## Was der Test beweist (und was nicht)

`test/gateway-test.sh` startet das Paket wirklich (`compose.yaml` mit den gepinnten Images), verbunden über mTLS mit einem Wegwerf-Broker (Image aus `infra/broker`, Wegwerf-CA aus `infra/pki/pki.sh`). Geprüft werden: `render.sh` (ungültige ID, Host, Port: keine Datei geschrieben, alte Datei unberührt; gültiger Lauf: Modus 600, nur die Platzhalterzeilen weichen von der Vorlage ab), die Werte nach ADR-0020, root-eigene Geheimnisse mit Modus 600 (mit Gegenprobe ohne Kopie), Healthcheck ohne Geheimnis und ACL (`health` liest nur die Laufzeit, Z2M-Benutzer frei), Bridge online (`gw/<id>/bridge/connection` retained `1`), `zigbee2mqtt/x` kommt als `gw/<id>/z2m/x` an, ein Befehl `gw/<id>/z2m/x/set` kommt lokal genau einmal an, 20 QoS-1-Nachrichten während eines Ausfalls des Plattform-Brokers kommen nach dessen Neustart in Reihenfolge und ohne Duplikate an; dasselbe mit 20 QoS-0-Nachrichten (Z2M publiziert QoS 0) bei gekappter Netzverbindung, nachdem die Bridge den Ausfall bemerkt hat.

Für Zigbee2MQTT gibt es ohne Adapter eine Grenze: Z2M liest und wendet die Einstellungen an, startet `zigbee-herdsman`, scheitert am Öffnen der seriellen Schnittstelle (`/dev/null` steht stellvertretend) und beendet sich. Bewiesen sind damit die Variablennamen (sie landen in den richtigen Schlüsseln), dass die Einstellungen gültig sind, dass Geräte und Namen erhalten bleiben und dass ein erneuter Start die Datei nicht mehr ändert. **Nicht** bewiesen sind der Verbindungsaufbau von Z2M zu Mosquitto (das passiert erst nach dem Adapter), das Frontend und die Zigbee-Funktion; sie prüft die Inbetriebnahme am echten Pi (Runbook). Die Anmeldung mit den Z2M-Zugangsdaten am lokalen Broker prüft der Test mit demselben Benutzer und Passwort über `mosquitto_pub`.
