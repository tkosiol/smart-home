# Etappe 6c-1: Verläufe – Design

- Status: freigegeben (Till, 2026-10-27, im Chat; „zieh durch“)
- Bezug: Architektur-Spec 8.4 (Telemetrie), 8.9 (API), 10 (Frontend); Designkonzept 3.3 (Gerätedetail), 7 (`ui-chart`); Issue #30
- Gestaltungsvorlage: Artefakt „Verlauf · Entwurf“ (Fable, 2026-10-27), Quelle `verlauf-entwurf.html` im Scratchpad der Sitzung; die verbindlichen Entscheidungen daraus stehen in Abschnitt 4.

## 1. Ziel

Auf der Geräteseite zeigt eine Karte „Verlauf“ die Geschichte jedes numerischen Messwerts über **24 h, 7 Tage und 4 Wochen** – modern, ruhig, M3. Till sieht damit die Bodenfeuchte seiner Pflanzen: Austrocknen, Gießen, Zeiten unter der Schwelle.

**Nicht in 6c-1:** SSE und Live-Aktualisierung (6c-2), Räume, Befehle, Kopplungsmodus. Die Karte lädt beim Öffnen, beim Wechsel von Messwert oder Zeitraum und alle 5 Minuten, solange die Seite sichtbar ist.

## 2. Daten (Backend)

### 2.1 Stundenaggregat

`measurements_hourly` als TimescaleDB Continuous Aggregate über `measurements` (nur Zeilen mit `value_num`):

| Spalte                    | Bedeutung                                         |
| ------------------------- | ------------------------------------------------- |
| `bucket`                  | Stundenbeginn in UTC (`time_bucket('1 hour')`)    |
| `device_id`, `capability` | wie in `measurements`                             |
| `avg`, `min`, `max`       | über die Werte der Stunde                         |
| `last`                    | letzter Wert der Stunde (`last(value_num, time)`) |
| `sum`, `count`            | für Tagesmittel über mehrere Stunden              |

- Echtzeit-Aggregation an (`timescaledb.materialized_only = false`): Die laufende Stunde und noch nicht materialisierte Stunden kommen aus den Rohdaten dazu, der Verlauf reicht bis „jetzt“.
- Refresh-Policy: `start_offset` 7 Tage, `end_offset` 1 Stunde, alle 30 Minuten. Nachgelieferte Pufferdaten des Pi (bis 72 h, ADR-0020) landen so im Aggregat.
- Unbegrenzt aufbewahrt (die Rohdaten-Retention von 1 Jahr greift nicht auf das Aggregat).
- **Anlegen:** in der Migration mit `WITH NO DATA` (läuft in Drizzles Transaktion). **Nachrechnen der Historie:** `refresh_continuous_aggregate` darf nicht in einer Transaktion laufen; deshalb rechnet der Migrationsschritt (`src/migrate.ts`, läuft bei jedem Deploy vor dem Start der API) nach den Migrationen den Bereich nach, den das Aggregat noch nicht abdeckt: von der ältesten Rohzeile bis zur ältesten materialisierten Stunde, höchstens bis `now() - 1 hour`. Ist nichts offen, tut der Schritt nichts.

### 2.2 Verlaufs-API

`GET /api/v1/households/:householdId/devices/:deviceId/history?capability=<key>&range=24h|7d|28d`

- Rolle: `viewer` (jedes Mitglied). Fremder Haushalt oder unbekanntes Gerät → 404 wie bei `GET devices/:deviceId`.
- `capability` muss ein lesbarer, numerischer Messwert des Geräts sein, der keine Einstellung ist; sonst 400 (`validation.failed`).
- Fenster endet bei der Anfragezeit (`to`); `from` = `to` − 24 h / 7 Tage / 28 Tage.
- Auflösung:
  - `24h`: 15-Minuten-Buckets aus den Rohdaten (`time_bucket('15 minutes')`), `resolution: '15m'`.
  - `7d`, `28d`: Stundenwerte aus `measurements_hourly`, `resolution: '1h'`.
- Tageswerte (`days`) für `7d` und `28d`, für `24h` leer: Kalendertage in der **Zeitzone des Haushalts** aus dem Stundenaggregat, `time_bucket('1 day', bucket, <timezone>)`, Mittel als `sum(sum)/sum(count)`, Tief `min(min)`, Hoch `max(max)`, letzter Wert `last(last, bucket)`. Tage mit 23 oder 25 Stunden (Zeitumstellung) sind korrekt. Der erste Tag kann angeschnitten sein (`partial: true`), der heutige ebenso.
- Buckets ohne Messwerte fehlen in der Antwort (keine Nullen). Lücken zeigt das Diagramm als Unterbrechung, wenn zwischen zwei Punkten mehr als das Doppelte der Auflösung liegt.
- Zeiten nur UTC (`…Z`), Datumswerte `YYYY-MM-DD` (ADR-0014).

**Antwort (`@smart/contracts`, `deviceHistorySchema`):**

```ts
{
  capability: string; // z. B. 'soil_moisture'
  unit: string | null; // aus der Fähigkeit
  range: '24h' | '7d' | '28d';
  resolution: '15m' | '1h';
  from: string; // UTC
  to: string; // UTC
  points: {
    t: string;
    avg: number;
    min: number;
    max: number;
    last: number;
  }
  []; // t = Bucket-Beginn, aufsteigend
  days: {
    date: string;
    avg: number;
    min: number;
    max: number;
    last: number;
    partial: boolean;
  }
  [];
}
```

Die API liefert Zahlen, keine Texte. Ableitungen für die Anzeige (Gießen, Zeit unter der Schwelle, Zusammenfassung) sind reine Funktionen in `@smart/contracts` (Abschnitt 3), damit Backend und Frontend sie später gleich verstehen.

## 3. Reine Funktionen (`@smart/contracts`)

- `wateringEvents(points, { minRise })`: Zeitpunkte, an denen die Bodenfeuchte gegenüber dem vorigen Punkt um mindestens `minRise` Prozentpunkte steigt (Standard 10); der Zeitpunkt ist der erste Punkt nach dem Sprung. Mehrere Anstiege innerhalb von 2 Stunden zählen als ein Gießen.
- `timeBelow(points, threshold, resolution)`: Dauer (Minuten), in der `avg` unter der Schwelle lag, auf Buckets gerundet.
- `historySummary(history, threshold)`: Tief, Hoch (mit Zeitpunkt), Zeit unter der Schwelle, Anzahl Gießen, letztes Gießen.
- Tests auch unter `TZ=Pacific/Chatham`.

## 4. Darstellung (Frontend)

### 4.1 `ui-chart` (`@smart/ui`, öffentliche API, nie in `shell.ts`)

- Apache ECharts (Apache-2.0), tree-shaken (`echarts/core` mit Line-Chart, Grid, MarkArea, MarkLine, MarkPoint, AxisPointer, Tooltip ohne Inhalt) und **SVG-Renderer**. ECharts lädt per `import()` beim ersten Diagramm; das initiale Bundle ändert sich nicht (gemessen).
- Eingaben: `points` (`{ t: string; value: number; min?: number; max?: number }[]`), `kind` (`'area'` Linie mit Fläche, `'ribbon'` Linie mit Band Tief–Hoch, `'step'` Stufenlinie), `domain` (`{ min, max }`, sonst automatisch mit Luft), `band` (`{ below: number; label: string; valueLabel: string }` für „zu trocken“), `markers` (`{ t: string }[]` als hohle Ringe), `unit`, `timeZone`, `range` (für die Achsenbeschriftung), `label` (Name des Diagramms) und `description` (Textalternative). Ausgabe `scrubbed`: der gewählte Punkt (`index` oder `null`).
- Gestaltung nach dem Entwurf: keine Achsenlinien, keine Ticks; Hilfslinien `outline-variant` dünn; y-Beschriftung in der Fläche über ihrer Hilfslinie (`label-medium`, `on-surface-variant`, Halo in der Kartenfarbe); x-Beschriftung nur darunter. Linie 2 px `primary`, runde Ecken, monotone Glättung; Fläche `primary` mit Verlauf von rund 20 % zu 0 % (dunkel 26 %). Band „zu trocken“ in `--smart-status-dry-container` (hell rund 42 %, dunkel 50 %) von 0 bis zur Schwelle, Schwellenlinie 1 px `--smart-status-dry`, Text „25 %“ über der Linie und „zu trocken“ im Band; Linienabschnitte unter der Schwelle in `--smart-status-dry` (ECharts `visualMap`; Wechsel am nächsten Punkt ist zulässig). Jetzt-Punkt am rechten Rand (`primary`, Ring in der Kartenfarbe). Band Tief–Hoch `primary` rund 16 % (dunkel 22 %). Alle Farben aus Rollen, gelesen aus den CSS-Variablen; bei Theme-Wechsel neu gesetzt.
- Achsenbeschriftung in Haushaltszeit: 24 h „18 Uhr / 0 Uhr / 6 Uhr / 12 Uhr“; 7 Tage Wochentag in der Tagesmitte, rechts „Heute“ (auf schmalen Breiten der Wochentag); 4 Wochen Montage „5. Okt.“ (auf schmalen Breiten jeder zweite) und rechts „Heute“; Beschriftungen, die „Heute“ zu nahe kommen, entfallen. Texte über Transloco (`ui.chart.*`), Datumsformate über die vorhandenen Zeit-Formatierer.
- Bedienung: Wischen/Zeigen setzt eine senkrechte Hilfslinie und meldet `scrubbed`; Verlassen meldet `null`. Mit Fokus auf dem Diagramm: ← → ein Punkt, Pos1/Ende erster/letzter, Esc beendet. Das Diagramm ist `role="group"` mit `aria-roledescription` „Diagramm“, `aria-label` und `aria-describedby` auf die Beschreibung; `touch-action: pan-y`; Fokusring wie die Buttons.
- Keine Einblendanimation (`animation: false`); Farbwechsel bei `prefers-reduced-motion` ohne Übergang.
- Größe: füllt die Breite; Höhe neues Token `--smart-size-chart` (200 px) bzw. `--smart-size-chart-large` (240 px) ab Expanded.

### 4.2 Bausteine

- `ui-chip-set`: nicht gewählte Chips **tonal** (`surface-container-high`, ohne Rand), gewählte `secondary-container` mit Haken; gilt überall in der App. Auf schmalen Breiten scrollt die Reihe seitlich mit ausgeblendeter Kante und Snap.
- `ui-segmented-button`: als M3-Expressive-Buttongruppe – 40 px, 2 px Abstand, äußere Enden `corner-full`, innere `corner-small`; gewählt **ruhig** in `secondary-container` / `on-secondary-container` (nicht `primary`).

### 4.3 Karte „Verlauf“ (Feature `devices`)

- Auf der Geräteseite unter den Nebenwerten; ab Expanded rechts neben Hero und Nebenwerten (zwei Spalten).
- Kopf: Titel „Verlauf“ (`title-large`), rechts tonaler Icon-Button „Werte als Tabelle“ (`aria-pressed`).
- Messwert-Chips (`ui-chip-set`, eine Auswahl): alle lesbaren numerischen Messwerte des Geräts ohne Einstellungen, zuerst der Hauptwert (`primaryCapability`), dann Temperatur, Luftfeuchte, Batterie, dann die übrigen; Namen aus den vorhandenen Fähigkeits-Übersetzungen (`app.*`, z. B. „Bodenfeuchte“). Ein einziger Messwert → keine Chips.
- Anzeige über dem Diagramm: Wert groß (`ui-value-display`), darunter eine Zeile – in Ruhe „Jetzt · zuletzt gegossen vor 3 Tagen“ (Gießen nur bei Bodenfeuchte), beim Wischen „Fr, 23. Okt., 23–24 Uhr · zu trocken“. `aria-live="polite"`.
- Darstellung je Messwert und Zeitraum: Bodenfeuchte immer `area` (24 h 15-Minuten-Werte, 7 Tage und 4 Wochen Stundenwerte) mit Band „zu trocken“ an der **effektiven unteren Schwelle des Geräts** (`effectiveThresholds.soilMoistureMin`; ohne Schwelle kein Band), Bereich 0–80 % fest, Gießen als Ringe; Temperatur und Luftfeuchte `area`, über 4 Wochen `ribbon` aus den Tageswerten; Batterie `step` aus `last`; andere Messwerte `area`.
- Unter dem Diagramm die Zusammenfassung als Text, z. B. „Tief 20 % · Hoch 55 % · 24 Std. zu trocken · 4× gegossen“ (nur, was zutrifft); darunter der Zeitraum (`ui-segmented-button`: „24 h“, „7 Tage“, „4 Wochen“; Standard 7 Tage).
- Tabelle: statt des Diagramms eine Liste auf `surface-container-lowest`, neueste zuerst, Kopf bleibt stehen; 24 h und 7 Tage je Bucket (Zeit · Wert), 4 Wochen je Tag (Tag · Mittel · Tief–Hoch) mit Hinweis „zeitweise zu trocken · gegossen“ als zweite Zeile.
- Zustände: Laden (`ui-skeleton` in Diagrammhöhe), leer („Noch keine Messwerte in diesem Zeitraum“), Fehler (vorhandene Fehleranzeige mit „Erneut versuchen“).
- Gewählter Messwert und Zeitraum bleiben pro Gerät nicht gespeichert (Standard beim Öffnen: Hauptwert, 7 Tage).
- Texte im Transloco-Scope `devices` (de, en); `pnpm i18n:check`.

## 5. Tests

- **Backend (Testcontainers, echte TimescaleDB):** Aggregat liefert avg/min/max/last; Echtzeit-Anteil zeigt Werte der laufenden Stunde; Nachrechnen im Migrationsschritt füllt alte Daten und ist beim zweiten Lauf ein No-op; nachgelieferte Werte erscheinen nach Refresh; Tageswerte in `Europe/Berlin` am 25.10.2026 (25 Stunden) und in `Pacific/Chatham`; 404 für fremden Haushalt und unbekanntes Gerät; 400 für Einstellung, nicht numerischen oder unbekannten Messwert und ungültigen Zeitraum; leerer Verlauf.
- **Contracts:** `wateringEvents`, `timeBelow`, `historySummary` mit Grenzfällen (leere Reihe, Sprung genau `minRise`, zwei Anstiege in 2 Stunden, Schwelle `null`).
- **Frontend:** `ui-chart` Stories (Bodenfeuchte mit Band, Ribbon, Step, leer, schmal) hell und dunkel mit axe; Spec für Tastatur-Scrubbing und `scrubbed`; Karte: Chips/Zeitraum laden neu, Wischen ändert die Anzeige, Tabelle, Zustände; Achsenbeschriftung unter `TZ=Pacific/Chatham`.
- **Stack-E2E:** Mit dem Simulator erscheint auf der Geräteseite eines Bodensensors der Verlauf (Diagramm sichtbar, Zeitraum umschaltbar, Tabelle zeigt Zeilen).
- **Bundle:** initial unverändert (Grenze 425 kB); ECharts nur in einem lazy Chunk.

## 6. Doku

Architektur-Spec 8.4 (Aggregat ab 6c-1, Nachrechnen im Migrationsschritt) und 8.9 (Verlaufs-Endpunkt); Designkonzept 3.3 und 7 („24 h | 7 Tage | 4 Wochen“, Linien statt Balken, ruhige Zeitraum-Auswahl, tonale Chips); UI-README (`ui-chart`, Chips, Segmente); `CLAUDE.md` nur, falls sich Befehle oder Regeln ändern.
