# ADR-0003: Zentrale Logik auf dem VPS, Pi als Gateway mit Puffer

- Status: angenommen
- Datum: 2026-10-11

## Kontext

Automationen könnten lokal (Pi) oder zentral (VPS) laufen.

## Entscheidung

Gesamte Logik auf dem VPS; der Pi ist nur Gateway mit Messwert-Puffer; kritische Abläufe über direkte Zigbee-Bindings.

## Konsequenzen

Bei Internetausfall keine App-Steuerung und keine Automationen; kein zweiter Logik-Ort; späterer Hybrid-Betrieb bleibt möglich.

Details: Spec, Abschnitt 1.3, 4.1.
