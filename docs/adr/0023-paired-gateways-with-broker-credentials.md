# ADR-0023: Gekoppelte Gateways mit Broker-Zugangsschlüsseln

- Status: angenommen
- Datum: 2026-11-20

## Kontext

Home Assistant (ADR-0022) sollte nur mit einem Zertifikat der Offline-CA und Dateien auf dem Gerät angebunden werden (ADR-0002): Das geht nur über Till. Fremde Installationen sollen sich selbst anbinden, ohne Terminal, Zertifikat und Dateien. Die Offline-CA soll offline bleiben, und Tills Pi (Zigbee2MQTT-Bridge) soll bei mTLS bleiben.

## Entscheidung

- **Zwei Zugangsarten je Gateway (`auth`):** `certificate` (mTLS über Port 8883, Z2M-Gateways, ADR-0002 unverändert) und `credentials` (Benutzer und Schlüssel am Broker, nur Home Assistant).
- **Kopplungscode:** Der Eigentümer erzeugt in der App einen Code (8 Zeichen Crockford-Base32, 15 Minuten, einmal einlösbar, nur als SHA-256 gespeichert); Home Assistant löst ihn über einen öffentlichen Endpunkt ein (ohne Anmeldung, ohne `Origin`-Prüfung, nur mit `@Public()`; Rate-Limit je IP) und bekommt Gateway-ID, Benutzer, Schlüssel und die Adresse `wss://<app-adresse>/mqtt`. „Neu koppeln“ erhöht die Generation des Schlüssels; je Haushalt höchstens 5 nicht gesperrte gekoppelte Gateways.
- **Abgeleiteter Schlüssel:** `HMAC-SHA256(GATEWAY_CREDENTIAL_SECRET, Gateway-ID, Generation)`; nichts davon steht in der Datenbank. Die Datenbank ist die Wahrheit über Zugänge (Gateway, Generation, gesperrt); das Backend gleicht den Broker daran ab.
- **WebSocket über 443:** Der Broker bekommt einen internen WebSocket-Listener (8080, nie veröffentlicht) mit dem Plugin Dynamic Security; das Web-nginx leitet `/mqtt` dorthin. Der Zustand des Plugins liegt nur im tmpfs (`/mosquitto/run`). Das Backend steuert das Plugin über `$CONTROL` auf 1883 und gleicht nach jedem Verbindungsaufbau und alle 10 Minuten ab (Benutzer anlegen, veraltete Generation neu setzen, nicht mehr gültige löschen; unveränderte Benutzer bekommen keinen Befehl, weil `setClientPassword` bestehende Verbindungen immer trennt).
- **Rechte am Broker:** Standard „verboten“, eine Rolle mit dem Präfix `gw/%u/ha/#` und `gw/%u/bridge/connection`; die Client-ID `<id>-ha` ist an den Benutzer gebunden, damit kein Gateway fremde Verbindungen (auch die des Backends) verdrängt.
- **Eigentümer koppeln und sperren** gekoppelte Gateways selbst; Zertifikats-Gateways bleiben beim Plattform-Admin. Sperren löscht den Benutzer und trennt sofort, ohne CRL.
- **Verteilung:** HACS über ein Spiegel-Repository mit Release je Version; auf dem Pi bringt der Gateway-Deploy die Integration weiter mit.

## Konsequenzen

- Das Geheimnis `GATEWAY_CREDENTIAL_SECRET` kommt hinzu (`provision.sh`); sein Verlust oder Wechsel heißt: alle Home Assistant neu koppeln. Dafür braucht der Broker kein Backup, und ein Neustart heilt sich selbst (im Fenster bis zum Abgleich, höchstens 10 Minuten, lehnt der Broker bekannte Schlüssel ab; die Integration löst Reauth darum erst nach 15 Minuten Ablehnung aus).
- Nginx Proxy Manager braucht je Umgebung „Websockets Support“ (einmalig, von Hand).
- Ein weiterer öffentlicher Endpunkt (Einlösen) und ein weiterer öffentlicher Weg zum Broker (WebSocket mit Anmeldung); beides ist durch kurzlebige Einmalcodes, Rate-Limits, Standard „verboten“ und die Bindung an das eigene Präfix begrenzt. Offene Registrierung bräuchte darüber hinaus Kontingente und ein Größenlimit am Listener (Spec Abschnitt 14).
- Zwei Zugangsarten sind dauerhaft zu pflegen; Zigbee2MQTT per Code zu koppeln wäre später möglich.
- Der alte Weg für HA (YAML, Zertifikat, `provision-ha.sh`) entfällt.

Details: `docs/superpowers/specs/2026-11-20-ha-kopplung-design.md`; Betrieb: `docs/runbooks/gateway.md`, Abschnitt 13.
