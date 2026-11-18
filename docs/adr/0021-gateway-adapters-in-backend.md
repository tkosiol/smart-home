# ADR-0021: Gateway-Adapter im Backend

- Status: angenommen
- Datum: 2026-11-18

## Kontext

Bisher kannte das Backend nur eine Art von Gateway: Pi mit Zigbee2MQTT. Topics, Nutzlasten, `friendly_name`, IEEE-Adressen und Z2M-Werte (`ON`/`OFF`, Helligkeit 0–254, Mired) waren über Ingest, Datenmodell, Hinweise und Frontend verteilt. Die Plattform soll künftig auch Home Assistant und vielleicht weitere Systeme anbinden, ohne dass jede neue Art den Kern umbaut. Zu Hause sollen weiterhin keine Ports geöffnet werden, und die Teile, die dort laufen, sollen möglichst selten aktualisiert werden müssen.

## Entscheidung

- Jede Gateway-Art ist ein **Adapter im Backend** (`apps/backend/src/adapters/<kind>/`). Er übersetzt die Nachrichten seines Systems in neutrale Ereignisse (Hardware gelistet/gekoppelt/entfernt, Erreichbarkeit, Bericht, Lebenszeichen) und ab Etappe 6c-3 neutrale Befehle zurück. Die Teile zuhause leiten nur weiter (Pi-Bridge, später eine schlanke HA-Integration).
- Der Vertrag liegt in `core/adapters` und hängt nur von den Contracts ab; Kern-Module kennen keinen Adapter (Lint-Elementart `be-adapter`).
- Fähigkeiten tragen Schlüssel aus einem **eigenen Vokabular** (`@smart/contracts`, `vocabulary.ts`) mit festen Einheiten: Helligkeit in %, Farbtemperatur in K, binäre Werte als `true`/`false`. Unbekanntes reicht der Adapter unter eigenem Schlüssel durch.
- Adapter sind **zustandslos**. Was sie je Hardware und Fähigkeit über ihr Protokoll wissen müssen, speichert der Kern als `native` und gibt es ihnen beim Dekodieren zurück.
- Zigbee2MQTT ist der erste Adapter; Pi, Simulator, Broker und Topics bleiben unverändert.

## Konsequenzen

- Eine neue Gateway-Art braucht ein Adaptermodul, einen Eintrag in `GATEWAY_KINDS`, eine Zeile in `app.module.ts`, Übersetzungen für ihren Namen und Broker-Rechte für `gw/%u/<kind>/#`.
- Übersetzungsfehler werden mit einem normalen Deploy behoben, nicht durch Updates auf fremden Rechnern; dafür muss das Backend jedes Fremdformat kennen.
- Befehle (6c-3) bekommen `encodeCommand` am Adapter; die Bestätigung bleibt neutral im Kern.
- Wird später horizontal skaliert, verarbeitet je Gateway genau eine Instanz dessen Nachrichten; die Caches des Kerns lassen sich aus der Datenbank neu aufbauen.

Details: `docs/superpowers/specs/2026-11-18-adapter-schicht-design.md`.
