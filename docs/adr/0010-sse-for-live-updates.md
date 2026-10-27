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

## Nachtrag (2026-10-27, Etappe 6c-2): Client per `fetch` statt `EventSource`

`EventSource` kann eine 401-Antwort nicht erkennen: Eine abgelaufene Sitzung sähe wie ein Netzfehler aus. Der Client liest den Stream deshalb per `fetch` und erkennt 401 (`auth.required`) wie der `ApiClient`. Er verbindet selbst neu, mit Wartezeit 1 s, 2 s, 4 s … höchstens 30 s (±20 % Zufall), statt sich auf den Auto-Reconnect des Browsers zu verlassen. Nach jedem Neuverbinden lädt die App den Stand per REST.
