# Architekturüberblick

Kurzfassung der verbindlichen Spec ([`../superpowers/specs/2026-10-11-smart-home-architecture-design.md`](../superpowers/specs/2026-10-11-smart-home-architecture-design.md)).

```
HEIMNETZ                                      VPS
┌─────────────── Pi ───────────────────┐      ┌──────────────────────────────────────────────┐
│ Zigbee-Geräte ⇄ Koordinator (USB)    │      │ Reverse Proxy :443                            │
│   zigbee2mqtt ⇄ mosquitto (lokal) ───┼─mTLS─┼─▶ Broker :8883                                │
│                Bridge + Puffer       │      │ Stacks smart-prod / smart-staging:            │
└──────────────────────────────────────┘      │   web · api · db · broker (+ simulator)       │
                                              └──────────────────────────────────────────────┘
```

- **Gateway** (Pi): Zigbee2MQTT + Mosquitto, Bridge per mTLS zum VPS, puffert Messwerte bei Ausfall.
- **api** (NestJS): `platform/` (Technik), `core/` (gerätetyp-unabhängiger Kern), `modules/` (Features).
- **web** (Angular-PWA): `core/`, `shell/`, `features/`, Design-System `@smart/ui`.
- **db**: TimescaleDB; Messwerte hängen am logischen Gerät, nicht an der Hardware.

Entscheidungen im Detail: [`../adr/README.md`](../adr/README.md).
