# ADR-0002: Pi ↔ VPS über Mosquitto-Bridge mit mTLS und eigener CA

- Status: angenommen
- Datum: 2026-10-11

## Kontext

Der Pi steht hinter NAT; der VPS braucht Gerätedaten und muss Befehle senden; eingehende Ports im Heimnetz sind unerwünscht.

## Entscheidung

Mosquitto-Bridge vom Pi zum VPS-Broker über TLS mit Client-Zertifikaten einer eigenen CA; ACL per Zertifikats-CN.

## Konsequenzen

Port 8883 ist öffentlich, aber ohne gültiges Zertifikat scheitert der Handshake; CA-Schlüssel muss offline gesichert werden; neue Gateways brauchen nur ein Zertifikat.

Details: Spec, Abschnitt 4.

## Nachtrag (2026-11-20)

Diese Entscheidung gilt für **Zertifikats-Gateways** (`auth = certificate`, heute Zigbee2MQTT auf dem Pi). Home-Assistant-Gateways werden ohne Zertifikat mit einem Kopplungscode angebunden und verbinden sich per WebSocket mit Benutzer und Schlüssel; siehe ADR-0023. Die Offline-CA und der Port 8883 bleiben unverändert.
