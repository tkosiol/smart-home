# ADR-0004: Messwerte puffern, Befehle nie

- Status: angenommen
- Datum: 2026-10-11

## Kontext

Nach einem Ausfall nachgelieferte Daten sind wertvoll, nachgelieferte Befehle gefährlich.

## Entscheidung

Messwerte werden auf dem Pi gepuffert; Befehle werden mit QoS 0 gesendet und bei offline Gateway sofort abgelehnt.

## Konsequenzen

`GATEWAY_OFFLINE` als Fehlerfall in der App; Broker auf dem VPS stellt keine QoS-0-Nachrichten für offline Clients zu.

Details: Spec, Abschnitt 8.6.
