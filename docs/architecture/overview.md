# Architekturüberblick

Kurzfassung der verbindlichen Spec ([`../superpowers/specs/2026-10-11-smart-home-architecture-design.md`](../superpowers/specs/2026-10-11-smart-home-architecture-design.md)).

```
HEIMNETZ                                      VPS
┌─────────────── Pi ───────────────────┐      ┌──────────────────────────────────────────────┐
│ Zigbee-Geräte ⇄ Koordinator (USB)    │      │ Reverse Proxy :443                           │
│   zigbee2mqtt ⇄ mosquitto (lokal) ───┼─mTLS─┼─▶ Broker :8883                               │
│                Bridge + Puffer       │      │   ▲                                          │
│ Home Assistant + smart_bridge ───────┼─wss──┼─▶ web /mqtt ─▶ Broker :8080 (intern)         │
│  (optional, auch fremde Installation)│      │ Stacks smart-prod / smart-staging:           │
└──────────────────────────────────────┘      │   web · api · db · broker (+ simulator)      │
                                              └──────────────────────────────────────────────┘
```

- **Gateway** (Pi): Zigbee2MQTT + Mosquitto, Bridge per mTLS zum VPS, puffert Messwerte bei Ausfall.
- **Home-Assistant-Gateway** (optional, auf demselben Pi oder später eine fremde Installation): eigene Gateway-ID, gekoppelt mit einem Code aus der App (kein Zertifikat, ADR-0023); die Integration „Smart Home“ (`smart_bridge`, `integrations/home-assistant/`) verbindet sich per WebSocket über 443 (`wss://<app-adresse>/mqtt`, web-nginx → interner Broker-Listener 8080) mit Benutzer und abgeleitetem Schlüssel, ohne Puffer (jede Nachricht ist retained und trägt den vollständigen Stand; ADR-0022). Das Backend gleicht die Benutzer des Brokers (Dynamic Security, nur im tmpfs) mit der Datenbank ab.
- **api** (NestJS): `platform/` (Technik), `core/` (gerätetyp-unabhängiger Kern), `adapters/` (je Gateway-Art ein Übersetzer, heute Zigbee2MQTT und Home Assistant; ADR-0021), `modules/` (Features).
- **web** (Angular-PWA): `core/`, `shell/`, `features/`, Design-System `@smart/ui`.
- **db**: TimescaleDB; Messwerte hängen am logischen Gerät, nicht an der Hardware.

Entscheidungen im Detail: [`../adr/README.md`](../adr/README.md).
