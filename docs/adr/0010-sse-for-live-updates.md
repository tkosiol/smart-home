# ADR-0010: SSE für Live-Updates

- Status: angenommen
- Datum: 2026-10-11

## Kontext

Die App braucht Live-Daten; Befehle laufen über REST.

## Entscheidung

Server-Sent Events pro Haushalt statt WebSocket.

## Konsequenzen

Einfache Proxy-Konfiguration, Cookie-Auth, Auto-Reconnect; nur Server → Client.

Details: Spec, Abschnitt 8.7.
