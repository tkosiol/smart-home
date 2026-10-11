# Self-Hosting-Fähigkeit und Lizenz – Design-Nachtrag

|        |                                                        |
| ------ | ------------------------------------------------------ |
| Status | Entwurf zur Freigabe                                   |
| Datum  | 2026-10-11                                             |
| Bezug  | Ergänzt `2026-10-11-smart-home-architecture-design.md` |

## 1. Ziel

Das Projekt soll ein ernsthaftes Open-Source-Projekt sein, das andere **ohne Codeänderung und mit wenig Aufwand selbst betreiben** können. Der eigene Betrieb (VPS + Pi-Gateway, Staging/Produktion) bleibt unverändert und ist nur eine von mehreren Installationsvarianten.

Die Installationsvarianten selbst werden **später** gebaut (eigene Etappe nach Etappe 6). Dieses Dokument legt fest, welche Leitplanken ab sofort für jede Etappe gelten, damit dieser Schritt später ohne Umbau möglich ist.

## 2. Zielszenarien

| Szenario                               | Vorhanden beim Nutzer                      | Was das Projekt liefert                                                                       |
| -------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------- |
| **1 – Nur die Web-App**                | eigener MQTT-Broker + Zigbee2MQTT          | App (web, api, db), die sich mit dem vorhandenen Broker verbindet                             |
| **2 – Alles zu Hause**                 | ein Pi (ab Pi 4, 2 GB) oder Mini-PC        | ein Compose-Paket inklusive Broker und Zigbee2MQTT                                            |
| **3 – App und Zigbee-Bridge getrennt** | App-Rechner + Zigbee-Bridge an anderem Ort | App + Anbindung externer Gateways (wie der Betrieb des Maintainers: VPS + Pi per mTLS-Bridge) |

## 3. Verbindliche Leitplanken (ab Etappe 3)

1. **Gateway = Broker-Verbindung + Topic-Präfix.** Ein Gateway wird im Backend durch eine MQTT-Verbindung (URL, Zugangsdaten, optional TLS-Material) und ein Topic-Präfix beschrieben. Der zentrale Betrieb nutzt einen gemeinsamen Broker mit Präfix `gw/<gatewayId>/z2m`; Szenario 1 nutzt den Broker des Nutzers mit dem Z2M-Standardpräfix `zigbee2mqtt`. Ingest, Befehle und Live-Updates dürfen kein bestimmtes Präfix voraussetzen. (Wirkt auf Etappe 5 und 6; Spec-Abschnitte 4.4, 8.5, 8.6 sind entsprechend zu lesen.)
2. **Nichts Persönliches in Code oder Images.** Domains, Image-Registry, Mail-Absender, RP-ID für Passkeys, Zeitzonen-Default und Ähnliches kommen ausschließlich aus der Konfiguration (Env). Fest verdrahtete Werte des Maintainer-Betriebs gehören in `infra/` (Deploy des Maintainers), nie in `apps/` oder `packages/`.
3. **Externe Dienste sind optional.** Mailversand über eine Schnittstelle mit generischem SMTP-Adapter (Resend ist eine Option, nicht Voraussetzung). Backblaze, healthchecks.io und UptimeRobot sind Betriebswerkzeuge des Maintainers; die App startet und funktioniert ohne sie. Fehlt eine Mail-Konfiguration, ist Login per E-Mail-Code deaktiviert und Passkeys bleiben der einzige Weg (die App zeigt das klar an).
4. **Pi-taugliche Images.** Alle Images werden zusätzlich für `linux/arm64` gebaut, spätestens mit der Self-Hosting-Etappe. Der Speicherbedarf des Stacks (web, api, db, broker) wird gemessen; Ziel: Betrieb auf einem Pi 4 mit 2 GB RAM.
5. **HTTPS ist Voraussetzung.** Passkeys (WebAuthn) funktionieren nur in einem sicheren Kontext mit festem Hostnamen; eine LAN-IP über HTTP genügt nicht. Die App erkennt einen unsicheren Kontext und erklärt ihn verständlich. Die Installationsanleitung zeigt mindestens einen einfachen Weg zu HTTPS (z. B. Tailscale-Zertifikat oder Reverse Proxy mit Let's Encrypt).
6. **Daten- und Konfigurationsformat stabil halten.** Migrationen bleiben rückwärtskompatibel (Expand/Contract, siehe Spec 6.2); Env-Variablen werden nur mit Übergangsphase umbenannt, weil fremde Installationen sie verwenden.

## 4. Spätere Etappe „Self-Hosting-Paket“ (nach Etappe 6)

Umfang, wenn die App fachlich genug kann:

- Compose-Profile für die Szenarien 1–3 aus denselben Images
- Installationsskript, das Szenario, Domain/Hostname und optionale Dienste abfragt und eine `.env` erzeugt
- Multi-Arch-Images (`amd64`, `arm64`), versionierte Releases (SemVer, Changelog, GitHub Releases) zusätzlich zu den Commit-Tags
- englische README für Außenstehende mit Schnellstart (< 15 Minuten für jemanden mit Docker-Grundkenntnissen), Screenshots und Abgrenzung zu bestehenden Lösungen
- `CONTRIBUTING.md`, Issue-Vorlagen, Sicherheitsrichtlinie (`SECURITY.md`)

Eigenes Brainstorming und eigene Spec zu Beginn dieser Etappe.

## 5. Lizenz

- **AGPL-3.0-only.** Nutzung, Änderung und Selbsthosting sind frei; wer eine veränderte Version als Netzwerkdienst für andere betreibt, muss den geänderten Quellcode offenlegen.
- Umsetzung: `LICENSE` mit dem offiziellen Lizenztext, `"license": "AGPL-3.0-only"` in allen `package.json`, Lizenzhinweis in der README.
- Abhängigkeiten unter MIT, Apache-2.0, BSD und ISC sind mit AGPL-3.0 kompatibel; neue Abhängigkeiten mit restriktiveren oder unklaren Lizenzen werden vor der Aufnahme geprüft.
- Solange ausschließlich der Maintainer beiträgt, bleibt ein späterer Lizenzwechsel möglich; ab externen Beiträgen nur mit deren Zustimmung.

## 6. Auswirkungen auf bestehende Dokumente

- Spec, Abschnitt 1.3: „Andere Installationsvarianten als VPS + Gateway“ ist Nicht-Ziel _vorerst_, wird aber durch die Leitplanken offengehalten.
- Spec, Abschnitt 13: neue Etappe „Self-Hosting-Paket“ nach Etappe 6, vor dem Pflanzenmodul oder parallel dazu.
- ADR-0018 (Self-Hosting-Leitplanken), ADR-0019 (Lizenz AGPL-3.0-only).
