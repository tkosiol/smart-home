# ADR-0020: Bridge-Puffer und Topic-Konfiguration (Ergebnis Spike 2b)

- Status: angenommen
- Datum: 2026-10-14

## Kontext

Spike 2b hat die Mosquitto-Bridge Pi → VPS (ADR-0002) und die Pufferung (ADR-0004) mit Docker nachgestellt: Mosquitto 2.0.22 und 2.1.2, mTLS mit Wegwerf-CA, Netzausfall, Broker-Neustart, harter Abbruch, Puffer bis 60 000 Nachrichten. Befunde: Die Bridge puffert und liefert in Reihenfolge ohne Duplikate nach, auch über einen Neustart des Pi-Brokers; mit `try_private true` entstehen keine Schleifen; QoS-0-Befehle an ein offline Gateway werden mit `queue_qos0_messages false` verworfen; Mosquitto 2.0.22 verliert Nachrichten, wenn QoS 0 und QoS 1 gemischt in der Bridge-Queue liegen, 2.1.2 nicht.

## Entscheidung

- **Version:** Mosquitto 2.1.x (gepinnt) auf Pi und VPS.
- **Bridge-Topics:** `topic # out 1 zigbee2mqtt/ gw/<id>/z2m/`, `topic +/set in 0 zigbee2mqtt/ gw/<id>/z2m/`, `topic bridge/request/# in 0 zigbee2mqtt/ gw/<id>/z2m/`, `try_private true`, `cleansession false`. Befehlsregeln bleiben QoS 0, damit Befehle nie nachgeliefert werden.
- **Status:** `notification_topic gw/<id>/bridge/connection` (retained, `1`/`0`, Last Will) ist das Online-Kriterium eines Gateways; `keepalive_interval 20` (Ausfall erkannt nach höchstens rund 30 s).
- **Pi-Puffer für 72 h:** `persistence true`, `autosave_interval 300`, `queue_qos0_messages true`, `max_queued_messages 75000`, `max_queued_bytes 75497472`; kein `per_listener_settings` auf dem Pi; Speicherlimit des Containers als Schutz, weil die Limits die QoS-0-Queue nicht begrenzen.
- **VPS:** `per_listener_settings true`, `queue_qos0_messages false`, mTLS und ACL wie Architektur-Spec 4.3; Gateway-IDs nur nach festem Muster, reservierte Namen (Benutzer des Backends und des Simulators) sind als Zertifikats-CN verboten.
- **Messzeit:** `last_seen` aus der Nachricht (nach UTC umgerechnet), Empfangszeit nur als Ersatz; der Ingest ist idempotent.

## Konsequenzen

- Geplante Neustarts und Netzausfälle bis 72 h verlieren keine Messwerte, solange Z2M mit QoS 1 publiziert; mit QoS 0 gehen bei einem ungeplanten Netzausfall die Nachrichten der rund 30 s vor der Erkennung verloren. Ein Stromausfall am Pi verliert bis zu 5 min (Autosave).
- Ein Befehl im Erkennungsfenster geht still verloren; das Backend wertet Befehle nur über die Rückmeldung des Geräts als erfolgreich (Architektur-Spec 8.6).
- Die ACL verwirft unerlaubte Nachrichten still; jede Inbetriebnahme eines Gateways enthält einen Schreib-/Lesetest.
- Offen für Etappe 5b: QoS-Verhalten des echten Z2M, Dauerlast mit gemischter Queue auf 2.1.x, Nachliefer-Spitze gegen das Backend.
