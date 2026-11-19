# ADR-0022: Home Assistant als Gateway-Art mit eigener Integration

- Status: angenommen
- Datum: 2026-11-19

## Kontext

Nach der Adapter-Schicht (ADR-0021) soll Home Assistant (HA) die zweite Gateway-Art werden. Erster Nutzen: Tills Yeelight-Lampen, die HA lokal steuert, sollen in der App mit Zustand, Helligkeit und Farbtemperatur erscheinen. Später sollen auch fremde HA-Installationen ohne Pi andocken können, ohne Ports zu öffnen. Zuerst läuft HA auf Tills Pi (3B+, 1 GB), neben Mosquitto und Zigbee2MQTT, die unverändert bleiben sollen. HA selbst kann nur mit einem MQTT-Broker verbunden sein, und seine Bordmittel (`mqtt_statestream`) liefern keine Geräteangaben.

## Entscheidung

- **Eigene, schlanke Integration** `smart_bridge` (`integrations/home-assistant/`). Sie reicht Geräte, Entitäten und Zustände unverändert weiter und wählt nur grob aus (Domänen `light`, `switch`, `sensor`, `binary_sensor`). Was daraus Fähigkeiten, Einheiten und Verfügbarkeit werden, entscheidet der Adapter `ha` im Backend.
- **Direktverbindung per mTLS:** Die Integration bringt ihren eigenen MQTT-Client mit (paho-mqtt, im HA-Image enthalten) und spricht den Plattform-Broker auf 8883 an, auch auf dem Pi, nicht über den lokalen Mosquitto. Einen Puffer braucht sie nicht: Jede Nachricht ist retained und trägt den vollständigen Stand, nach einer Unterbrechung zählt der aktuelle Zustand. So ist der Weg auf dem Pi derselbe wie später bei fremden Installationen.
- **Ein HA = ein Gateway:** eigene Gateway-ID, eigenes Zertifikat, Art `ha`, Präfix `gw/<id>/ha`. Das Datenmodell (Gateway = Verbindung + Präfix + Art) bleibt; auf dem Pi gibt es damit zwei Gateways.
- **Schnappschuss je Gerät:** Eine Nachricht trägt alle weitergereichten Entitäten eines Geräts. So leitet der zustandslose Adapter Verfügbarkeit und Messzeitpunkt aus einer Nachricht ab.
- **Python nur in `integrations/home-assistant/`**, mit `ruff` und pytest, ausgeführt in Containern (keine Python-Installation auf dem Mac nötig).

## Konsequenzen

- Eine zweite Sprache mit eigener Testsuite (`bash integrations/home-assistant/test/run-tests.sh`, CI-Job `ops (ha-integration)`): pytest gegen eine HA-Testumgebung und ein Lauf im gepinnten HA-Image gegen das echte Broker-Image.
- Ein Update der Integration ist nur bei einer neuen Domäne oder einer Änderung des Protokolls nötig. Neue Fähigkeiten aus bereits weitergereichten Domänen entstehen im Backend (normaler Deploy).
- Installation über HACS und Einrichtung per Kopplungscode für fremde Installationen kommen später; bis dahin wird die Integration per YAML konfiguriert und auf dem Pi vom Gateway-Deploy mitgebracht.
- `mem_limit` des HA-Dienstes (512 MB, gemessen rund 300 MB) wirkt auf dem Pi erst mit eingeschalteter Speicher-Cgroup (Runbook `docs/runbooks/gateway.md`); bis dahin entscheidet bei Speichernot der OOM-Killer des Kernels.
- Ein Fehler von HA beim Deploy ist nur eine Warnung; Zigbee2MQTT bleibt davon unberührt.

Details: `docs/superpowers/specs/2026-11-19-home-assistant-adapter-design.md`.
