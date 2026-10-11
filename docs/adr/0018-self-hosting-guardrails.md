# ADR-0018: Self-Hosting-Leitplanken

- Status: angenommen
- Datum: 2026-10-11

## Kontext

Das Projekt soll für andere einfach selbst betreibbar werden (nur Web-App mit eigenem Broker, alles zu Hause, App und Zigbee-Bridge getrennt). Die Installationsvarianten werden erst nach Etappe 6 gebaut, die Architektur darf sie bis dahin aber nicht verbauen.

## Entscheidung

Ab Etappe 3 gelten verbindlich: Gateway = Broker-Verbindung + Topic-Präfix; nichts Persönliches in Code oder Images; externe Dienste optional (generisches SMTP); Pi-taugliche Images (`arm64`, Ziel 2 GB RAM); HTTPS als dokumentierte Voraussetzung für Passkeys; stabile Daten- und Konfigurationsformate.

## Konsequenzen

Etappe 5/6 modellieren Gateways allgemeiner als nur für den eigenen VPS-Betrieb; Werte des Maintainer-Betriebs bleiben in `infra/`. Eine eigene Etappe „Self-Hosting-Paket“ liefert später Compose-Profile, Installer, Releases und englische Doku.

Details: `docs/superpowers/specs/2026-10-11-self-hosting-and-license-design.md`.
