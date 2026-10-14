# Etappe 6a: Sensoren sehen – Spec

|        |                                                                                                                                 |
| ------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Status | Freigegeben (Till, 2026-10-14)                                                                                                  |
| Datum  | 2026-10-14                                                                                                                      |
| Bezug  | Architektur-Spec Abschnitte 8.4, 8.5, 8.9, 9, 10.7; ADR-0006, ADR-0014, ADR-0018, ADR-0020; Spec Etappe 5 (Gateways, Simulator) |

## 0. Zu prüfen (Entscheidungen, die Till bestätigen soll)

1. **Etappe 6 in zwei Teilen:** 6a = Geräte erkennen, zuordnen, Messwerte speichern und aktuelle Werte anzeigen; 6b = Verlaufsdiagramme, Räume, Live-Aktualisierung (SSE), Befehle (Lampe), Kopplungsmodus.
2. **Aus Hardware wird ein Gerät nur durch einen owner** (Architektur-Spec 7.1: Hardware-Zuordnung ist owner-Recht). Alle Mitglieder sehen die Geräte und ihre Werte.
3. **Angezeigt werden nur Messwerte**, also lesbare Werte, die das Gerät selbst meldet (z. B. Bodenfeuchte, Temperatur, Luftfeuchte, Batterie, „trocken“). Einstellungen des Sensors (Kalibrierung, Messintervall, Warnschwelle) erscheinen in 6a nicht.
4. **Ohne Live-Verbindung:** Die Seiten laden die Werte beim Öffnen und alle 60 s neu, solange sie sichtbar sind. Live-Updates per SSE kommen in 6b.
5. **Übersicht zeigt eine Karte je Gerät** mit dem wichtigsten Wert (bei Bodensensoren die Bodenfeuchte) und dem Batteriestand.

## 1. Ziel

Nach 6a erscheinen die sechs Pflanzensensoren (und die Lampe) in der App: Ein owner macht aus erkannter Hardware ein Gerät – der Name aus Z2M ist vorbelegt –, alle sehen die aktuellen Werte auf der Übersicht und der Geräteseite. Ab der Zuordnung werden Messwerte dauerhaft gespeichert, damit 6b sofort Verläufe zeigen kann. Bis 5b läuft alles mit dem Simulator; danach mit den echten Sensoren, ohne Codeänderung.

## 2. Datenmodell (Architektur-Spec 8.4)

Neues Core-Modul `core/devices` (Hardware, Fähigkeiten, Geräte, Bindungen, Zustand) und `core/telemetry` (Messwerte); beide nutzen `core/gateways` und `core/households` über deren `index.ts`.

| Tabelle           | Felder (6a)                                                                                                                                                                                                                                                                               |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hardware`        | `id`, `gateway_id`, `ieee_address`, `friendly_name`, `vendor`, `model`, `description`, `definition` (JSON, Z2M-Definition mit _exposes_), `interview_state`, `availability`, `last_state` (JSON), `first_seen_at`, `last_seen_at`, `removed_at`; eindeutig (`gateway_id`, `ieee_address`) |
| `capabilities`    | `hardware_id`, `key` (Property, z. B. `soil_moisture`), `kind` (`numeric`/`binary`/`enum`/`text`/`composite`), `unit`, `min`, `max`, `step`, `enum_values`, `readable`, `writable`, `is_setting`                                                                                          |
| `devices`         | `id`, `household_id`, `name`, `icon`, `created_at`, `archived_at` (`room_id` folgt in 6b)                                                                                                                                                                                                 |
| `device_bindings` | `device_id`, `hardware_id`, `bound_at`, `unbound_at`; höchstens eine aktive Bindung je Gerät und je Hardware (partielle Unique-Indizes)                                                                                                                                                   |
| `device_state`    | `device_id` (PK), `state` (JSON, letzter Gesamtstand), `last_seen_at`, `availability`                                                                                                                                                                                                     |
| `measurements`    | Hypertable: `time`, `device_id`, `capability`, `value_num` (double), `value_text`, `flags`; eindeutig (`device_id`, `capability`, `time`)                                                                                                                                                 |

- `measurements`: Chunk 7 Tage, Kompression nach 7 Tagen (`segmentby device_id, capability`), Rohdaten 1 Jahr. Das Stundenaggregat folgt in 6b (es rechnet die Historie dann nach).
- `binary` als 0/1 in `value_num`, `enum` in `value_text`; `composite` und `text` nur in `device_state`. Einstellungen (`is_setting`) werden nicht als Messwerte gespeichert.
- `is_setting`: Fähigkeit ist schreibbar (`access` enthält „set“) **und** keine reine Aktion – Z2M-Kalibrierung, Intervalle und Schwellen; lesbare Messwerte ohne Schreibrecht sind nie Einstellungen.

## 3. Ingest (Architektur-Spec 8.5, angepasst)

Der Konsument abonniert die Präfixe aller registrierten, nicht gesperrten Gateways (`<topic_prefix>/#`, aus `gateways.topic_prefix`; neu registrierte Gateways werden ohne Neustart aufgenommen).

| Topic                                                     | Verarbeitung                                                                                                                                                                      |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<prefix>/bridge/devices` (retained)                      | Hardware und Fähigkeiten anlegen/aktualisieren; `friendly_name` ↔ IEEE-Zuordnung aktualisieren; nicht mehr gelistete Hardware `removed_at` setzen; der Koordinator wird ignoriert |
| `<prefix>/bridge/event`                                   | Kopplung, Interview, Umbenennen, Entfernen → Hardware aktualisieren                                                                                                               |
| `<prefix>/<name>/availability`                            | Verfügbarkeit von Hardware und gebundenem Gerät                                                                                                                                   |
| `<prefix>/<name>`                                         | Gerätenachricht                                                                                                                                                                   |
| `…/set`, `…/get`, `bridge/request/#`, sonstige `bridge/*` | ignoriert (auch für `last_message_at`, Übertrag aus 5a)                                                                                                                           |

**Gerätenachricht:** `<name>` über die aktuelle Zuordnung `friendly_name` → Hardware des Gateways finden (unbekannt → höchstens einmal pro Stunde je Name protokollieren, verwerfen); Felder gegen die Fähigkeiten prüfen (unbekannte oder ungültige Felder verwerfen, nie ganze Nachricht); Zeitstempel aus `last_seen` (UTC) mit Plausibilisierung nach Architektur-Spec 9.4 (mehr als 2 min in der Zukunft oder älter als 7 Tage → Empfangszeit, Flag `time_replaced`); `hardware.last_state` und `last_seen_at` setzen; bei aktiver Bindung `device_state` upserten und Messwerte gepuffert schreiben (alle 1 s oder 500 Zeilen, `ON CONFLICT DO NOTHING`). Fehler einer Nachricht beenden den Konsumenten nie; beim Herunterfahren wird der Puffer geleert.

## 4. API

Alle Pfade haushaltsbezogen (`HouseholdGuard`), fremd/unbekannt → `404`:

- `GET /api/v1/households/:id/hardware?state=unassigned` (owner): erkannte, nicht zugeordnete Hardware der Gateways des Haushalts mit Vorschau (`last_state`, Fähigkeiten, Verfügbarkeit, `friendly_name`).
- `POST /api/v1/households/:id/devices` (owner) `{ hardwareId, name }` → Gerät + Bindung; Hardware schon gebunden → `409 device.hardwareBound`.
- `GET /api/v1/households/:id/devices` (viewer): Geräte mit Zustand, Verfügbarkeit, letzter Meldung und den lesbaren Messfähigkeiten (Schlüssel, Art, Einheit).
- `GET /api/v1/households/:id/devices/:deviceId` (viewer): wie oben für ein Gerät.
- `PATCH /api/v1/households/:id/devices/:deviceId` (member) `{ name }` (Architektur-Spec 7.1: member darf umbenennen).

## 5. Oberfläche

- **Geräte (`/geraete`):** Liste der Geräte mit Name, Hauptwert, Batterie, „zuletzt gemeldet“ und Verfügbarkeit. Für owner oben der Abschnitt „Neu erkannt“: nicht zugeordnete Hardware mit Vorschau und „Als Gerät hinzufügen“ (Name aus Z2M vorbelegt, änderbar).
- **Gerät (`/geraete/:id`):** alle Messwerte mit Einheit und Zeitpunkt der letzten Meldung, Verfügbarkeit, Modell/Hersteller; Umbenennen (member).
- **Übersicht:** eine Karte je Gerät mit Hauptwert und Batterie; ohne Geräte ein Hinweis mit Weg zu „Geräte“.
- **Hauptwert:** erster vorhandener Wert aus `soil_moisture`, `temperature`, `humidity`, `state`, sonst der erste numerische Messwert.
- **Batterie niedrig** (unter 20 %): Hinweis am Gerät (Benachrichtigung folgt in Etappe 7).
- **Aktualisierung:** beim Öffnen, alle 60 s solange sichtbar, beim Zurückkehren zur Seite.
- Werte und Zeiten in der Haushaltszone; Zahlen mit `Intl.NumberFormat` der aktiven Sprache; Feldnamen bekannter Fähigkeiten übersetzt (`soil_moisture` → „Bodenfeuchte“), unbekannte zeigen den Schlüssel.

## 6. Tests

- Ingest gegen den echten Test-Broker: `bridge/devices` aus den Simulator-Fixtures legt Hardware und Fähigkeiten an (Einstellungen erkannt), Umbenennung in Z2M folgt, entfernte Hardware markiert; Gerätenachricht ohne Bindung → nur `last_state`; mit Bindung → `device_state` und Messwerte; unbekannte Felder verworfen; `last_seen` in der Zukunft/zu alt → Empfangszeit mit Flag; doppelte Nachricht → kein Duplikat; Nachrichten eines gesperrten oder fremden Gateways ignoriert; `/set` ignoriert.
- Mandantentrennung: Tabellentest um alle neuen Pfade erweitert.
- Frontend: Liste, „Neu erkannt“ nur für owner, Hinzufügen mit vorbelegtem Namen, Detail, Übersichtskarten, Aktualisierung, Texte de/en.
- Stack-E2E: Simulator-Gateway registrieren → „Neu erkannt“ zeigt sechs Sensoren und die Lampe → einen Sensor hinzufügen → Wert erscheint auf Übersicht und Geräteseite.

## 7. Nicht-Ziele (6b und später)

Verlaufsdiagramme und Stundenaggregat, Räume, SSE, Befehle und Bestätigung, Kopplungsmodus, Sensor-Tausch über die Oberfläche (Neu-Binden), Archivieren, Benachrichtigungen, Einstellungen der Sensoren ändern.
