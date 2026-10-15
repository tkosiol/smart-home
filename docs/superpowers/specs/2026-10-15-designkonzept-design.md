# Designkonzept – Spec

|        |                                                                                                                                                                                                   |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status | Freigegeben (Till, 2026-10-15)                                                                                                                                                                    |
| Datum  | 2026-10-15                                                                                                                                                                                        |
| Bezug  | Architektur-Spec Abschnitte 8.7, 8.8, 10; Spec Etappe 3 (Design-System); Spec Etappe 6a (Sensoren sehen); ADR-0011, ADR-0012; Design-Canvas (privat, bei Till), Richtung B und Zeile „B · Status“ |

## 0. Entscheidungen (von Till bestätigt am 2026-10-15)

Alle sechs Punkte sind so bestätigt. Ergänzung von Till: Schwellen sind je Geräteart voreingestellt und pro Gerät anpassbar (Abschnitt 4.3).

1. **Etappe 6b wird geteilt.** 6b = Designsprache (Tokens, neue `ui-*`-Bausteine, Übersicht mit Status-Hero, „Alle Hinweise“, „Übersicht anpassen“, Umbau der bestehenden Seiten, Hinweise im Backend). 6c = Räume, Verläufe, SSE, Befehle und Kopplungsmodus, von Anfang an in der neuen Sprache (Abschnitt 9). Empfehlung: ja, damit 6c nichts zweimal baut.
2. **Hinweise rechnet das Backend** (`core/attention`), nicht die App (Abschnitt 4.2). Empfehlung: ja; Benachrichtigungen (Etappe 7) brauchen dieselben Regeln.
3. **Warnfarbe:** eigener Orange-Ton für `warning` mit messbaren Abnahmekriterien; scheitert der Spike, bleibt `warning` = `error` (Abschnitt 6). Empfehlung: Spike zu Beginn von 6b, Dauer höchstens ein Tag.
4. **Anpassung der Übersicht wird je User und Haushalt gespeichert** (`memberships.overview_layout`, Abschnitt 5). Empfehlung: ja; Theme bleibt je User.
5. **Der Lampen-Pod ist der Schalter:** Tippen auf den ganzen Pod schaltet; Helligkeit und Farbtemperatur auf der Geräteseite (Abschnitt 3.1). Empfehlung: ja, mit sichtbarem Schwebezustand bis zur Bestätigung (Architektur-Spec 8.6).
6. **Favoriten kommen später** (Abschnitt 10). Blöcke in 6b: Status, Geräte, Gateway; 6c ergänzt Räume. Empfehlung: ja.

## 1. Ziel und Vorgaben

Die App bekommt die auf dem Canvas gewählte Richtung **B · Expressive**: große Formen, tonale Flächen je Geräteart, ein Status-Hero oben, darunter Räume mit Geräte-Pods. Alles entsteht aus Farbrollen und `--smart-*`-Tokens, damit Grundfarbe, Schema-Variante, Modus und Kontrast weiter frei wählbar bleiben.

Vorgaben (Till, 2026-10-15):

- **Material 3 bleibt**, der Farbgenerator (Architektur-Spec 10.5) bleibt; keine Fixfarben, keine Verläufe, keine Bilder als Atmosphäre.
- **Handy zuerst** (Compact); Tablet und Desktop über die Fensterklassen von `ui-adaptive-shell`.
- **Dichte als Mittelweg:** Status plus zwei bis drei Räume auf einen Blick, nicht gedrängt.
- **Smart-Home-App, keine Pflanzen-App:** Bodenfeuchte ist eine Geräteart unter mehreren.
- **Übersicht anpassbar, aber einfach:** Blöcke ein/aus und Reihenfolge; Standard „Status, dann Räume“.

## 2. Gestaltungssprache als Tokens

### 2.1 Form

| Element                                                    | Token                                  |
| ---------------------------------------------------------- | -------------------------------------- |
| Karten (Status-Hero, Raumkarte, Diagrammkarte, Sheet oben) | `--mat-sys-corner-extra-large` (28 px) |
| Pods, Einträge im Hero und in Listen                       | `--mat-sys-corner-large` (16 px)       |
| Chips, Pillen, Schalter, Icon-Buttons, Segmente            | `--mat-sys-corner-full`                |
| Diagrammbalken                                             | `--mat-sys-corner-extra-small`         |

Im Mockup haben Pods 20 px; umgesetzt wird `corner-large`. Liefert Angular Material ein `corner-large-increased` (20 px), nimmt `ui-device-pod` dieses.

### 2.2 Flächen

| Ebene                                      | Rolle                                                 |
| ------------------------------------------ | ----------------------------------------------------- |
| Seite                                      | `surface`                                             |
| Raumkarte, Diagrammkarte, Sheet, Ruhezeile | `surface-container-low`                               |
| Einträge im Hero, Zeilen im Sheet          | `surface-container-lowest`                            |
| Navigation Bar                             | `surface-container`                                   |
| Tonale Icon-Buttons, Segment-Hintergrund   | `surface-container-high`                              |
| Pod „aus“, Fortschrittsspur                | `surface-container-highest`                           |
| Status-Hero                                | `primary-container`, bei Kritischem `error-container` |

Keine Outlines, keine Schatten außer der M3-Elevation von Sheet und Dialog.

### 2.3 Typografie

Roboto Flex bleibt (selbst gehostet). Rollen aus `--mat-sys-*`; Zahlen immer `font-variant-numeric: tabular-nums`.

| Verwendung                             | Rolle / Token                                                                     |
| -------------------------------------- | --------------------------------------------------------------------------------- |
| Haushaltsname in der Top App Bar       | `headline-small`, Gewicht 600                                                     |
| Raumname, Seitentitel innerhalb Karten | `title-large`, Gewicht 600                                                        |
| Hauptwert auf der Geräteseite          | neuer Token `--smart-type-value-hero` (80/84 px, Gewicht 600, Laufweite −0,03 em) |
| Wert im Pod, Nebenwerte                | `headline-small`, Gewicht 600                                                     |
| Eintragstitel, Pod-Beschriftung        | `body-medium` / `body-small`, Gewicht 500–600                                     |
| Abschnittslabel (STATUS, BODENFEUCHTE) | `label-small`, Versalien, Laufweite 0,1 em                                        |

### 2.4 Farbe je Geräteart

Die Geräteart leitet `@smart/contracts` aus den Fähigkeiten ab (`deviceKind(capabilities)`, neben `primaryCapability`): `light` (schreibbares `state` oder `brightness`), `soil` (`soil_moisture`), `climate` (`temperature`/`humidity` ohne `soil_moisture`), `contact` (`contact`), sonst `other`. Die Zuordnung zur Farbrolle liegt in `@smart/ui`:

| Art                  | Pod                                                            | Icon-Container in Listen |
| -------------------- | -------------------------------------------------------------- | ------------------------ |
| `light`              | an: `primary` / `on-primary`; aus: `surface-container-highest` | `primary-container`      |
| `soil`               | `tertiary-container` / `on-tertiary-container`                 | `tertiary-container`     |
| `climate`, `contact` | `secondary-container` / `on-secondary-container`               | `secondary-container`    |
| `other`              | `surface-container-high` / `on-surface`                        | `surface-container-high` |

Statusfarben (`--smart-status-*`) markieren nur Zustände (Chip „trocken“, Batterie, offline), nie Geräte.

### 2.5 Abstände und Dichte

Nur `--smart-space-*`: Seitenrand `lg`, Karten-Innenabstand `lg` (Hero `xl` oben/unten), Abstand zwischen Karten `lg`, zwischen Pods `sm`. Pods 140 × 116 px als neue Tokens `--smart-size-pod-width`/`-height`; Zeilen mindestens `--smart-size-touch`; Hero höchstens drei Einträge plus Button (Abschnitt 4.1, Regel 5).

### 2.6 Motion

`--smart-motion-*`: Pod-Druck als State Layer plus Skalierung auf 0,98 (`short`); Farbwechsel des Hero und Wertewechsel über Opazität (`medium`); Sheet und Dialog gleiten (`medium`, `easing-standard`); Diagramme ohne Einblendanimation. Bei `prefers-reduced-motion: reduce` bleibt nur der Opazitätswechsel; nichts bewegt sich.

### 2.7 Gültigkeit

Jeder Baustein muss mit jeder Grundfarbe, jeder Schema-Variante, hell/dunkel und allen Kontraststufen funktionieren; das leisten die Rollen des Farbgenerators. Geprüft wird in Storybook (axe) nur **hell und dunkel mit der Standard-Grundfarbe und der Standardschrift** (Entscheidung Till, 2026-10-15): Grundfarben, Varianten, Kontraststufen und Schriften erzeugt die Software, dafür gibt es keine eigene Matrix je Baustein.

## 3. Bildschirme

### 3.1 Übersicht

- **Top App Bar:** Haushaltsname groß, rechts tonale Icon-Buttons „Übersicht anpassen“ und „Konto“.
- **Status-Block** (Abschnitt 4): Hero mit höchstens drei Einträgen und Button „Alle N Hinweise“, oder die Ruhezeile „Alles in Ordnung · Gateway online · n Geräte · vor 3 min“.
- **Raumkarten** (6c): Kopf mit Raumname als Link und rechts „n Geräte · alles ok“ oder Chip „n Hinweise“ in der Farbe der höchsten Art im Raum; darunter eine horizontal scrollende Reihe von Geräte-Pods (Snap, Tastatur, Pfeile ab Medium). In 6b, vor den Räumen, steht an dieser Stelle der Block **Geräte**: dieselben Pods in einer umbrechenden Reihe.
- **Geräte-Pod:** Icon oben links, Status-Chip oder Statuspunkt oben rechts, Wert groß, darunter Name · Nebenwert. Pod ist ein Link zur Geräteseite. Der **Lampen-Pod ist ein Schalter** (`aria-pressed`): Tippen schaltet, der Pod zeigt bis zur Bestätigung einen Schwebezustand (Opazität, Skeleton-Ring), bei `failed` eine Snackbar mit „Erneut“; Helligkeit und Farbtemperatur nur auf der Geräteseite.
- **Navigation Bar:** Übersicht, Geräte, Räume, Mehr; aktiver Eintrag mit `primary-container`-Pille.

### 3.2 Raum (6c)

Seite `/raeume/:id`: Top App Bar mit Zurück und Raumname, Status-Hero nur für Einträge dieses Raums (gleiche Regeln, gleiche Komponente), darunter die Pods des Raums als umbrechendes Raster, zuletzt die Reihenfolge der Geräte (Ziehgriff, owner und member).

### 3.3 Gerätedetail

- Kopf: Zurück, Name, Zeile „Art · Raum“, Overflow.
- Hero-Karte in der Farbe der Geräteart: Label, Hauptwert (`--smart-type-value-hero`), Status-Chip, Fortschrittsleiste mit markiertem Zielbereich, „aktualisiert vor n min“.
- Nebenwerte als drei Pods (`secondary-container`): Temperatur, Batterie, Signal; bei anderen Geräten die nächsten Messwerte nach `primaryCapability`.
- Diagrammkarte (6c): Titel „Verlauf“, Segment „24 h | 7 Tage“, `ui-chart` mit Balken je Stunde (24 h) oder je Tag (7 Tage), Bereich „zu trocken“ als Band in `dry-container`, Balken unterhalb der Schwelle in `dry`; Legende als Text.
- Darunter Pillen „Raum: …“ und „Grenzwerte“ (führt zur Karte „Grenzwerte“, Abschnitt 4.3).
- Lampe: Hero mit Schalter, Schieberegler für Helligkeit, Chips für Farbtemperatur.

### 3.4 Alle Hinweise

Seite `/hinweise`: Zurück, Titel, Zeile „N offen · nach Dringlichkeit, dann neueste zuerst“; Filter-Chips „Alle N · Kritisch k · Warnung w · Hinweis h“ (mehrere wählbar, Zahlen aus den Einträgen); Abschnitte je Dringlichkeit, darin eine Karte je Art mit Gruppentitel und Zähler; Eintrag: Icon-Container in der Artfarbe, Name, „Raum · vor n min“, Wert rechts in der Artfarbe, Chevron zum Gerät beziehungsweise Gateway. Leerzustand: „Nichts zu tun“ mit ok-Icon.

### 3.5 Übersicht anpassen

Bottom Sheet (ab Medium ein Dialog): Ziehgriff, Titel, Erklärung, Liste der Blöcke mit Ziehgriff (`aria-label` „Status verschieben“), Icon-Container, Name und Beschreibung, Schalter rechts; Aktionen „Zurücksetzen“ und „Fertig“. Tastatur: Fokus auf dem Ziehgriff, Pfeil hoch/runter verschiebt; Änderungen werden beim „Fertig“ gespeichert, Schließen ohne „Fertig“ verwirft.

### 3.6 Bestehende Seiten

- **Geräte:** Liste wird ein Raster aus Geräte-Pods, gruppiert nach Raum (6c; in 6b ohne Gruppierung); „Neu erkannt“ als Karte in `secondary-container` mit Pods und Button „Hinzufügen“.
- **Gateways:** Listeneinträge mit Status-Icon-Container (online `ok-container`, offline `error`, unbekannt `offline-container`), Zertifikatshinweis als Chip.
- **Mehr:** Listeneinträge mit tonalen Icon-Containern (40 px), Gruppen als Karten `surface-container-low`.
- **Einstellungen, Darstellung, Installation:** unverändert im Aufbau; Karten mit `corner-extra-large`, Titel in `title-large`.
- **Anmeldung:** eine Karte `corner-extra-large`, Titel `headline-small`, Primärbutton in voller Breite.
- **Top App Bar überall:** großer Titel auf Compact, tonale Icon-Buttons.

### 3.7 Tablet und Desktop

Fensterklassen aus `ui-adaptive-shell`: **Medium** (Rail): Übersicht zweispaltig (`ui-grid`), Hero über beide Spalten, Pods brechen um statt zu scrollen; Sheet wird Dialog. **Expanded** (Drawer): bis drei Spalten, Inhalt höchstens `--smart-size-content-max`; Geräteseite mit Werten links und Diagramm rechts. Nichts ist nur mit Maus bedienbar.

## 4. Statuslogik

### 4.1 Regeln (verbindlich)

1. **Drei Dringlichkeiten:** `critical` (Gateway offline, Gerät meldet nicht, später Leck/Rauch), `warning` (zu trocken, zu nass, Batterie schwach), `info` (Fenster offen, neue Hardware, Zertifikat läuft bald ab). Sortierung überall: Dringlichkeit absteigend, darin neueste zuerst.
2. **Gruppierung nach Art:** gleiche Art wird zu einem Eintrag („5 Pflanzen zu trocken“), der Untertitel nennt die Geräte (neueste zuerst, abgeschnitten). Eine Gruppe mit einem Gerät zeigt das Gerät direkt („Ficus ist zu trocken · 18 %“). Gruppen führen in „Alle Hinweise“ mit vorgewählter Art, Einzeleinträge zum Gerät.
3. **Ursachenunterdrückung:** Ist ein Gateway offline, entsteht genau ein kritischer Eintrag „Gateway … offline · n Geräte nicht erreichbar“; die Geräte dieses Gateways erzeugen keine Einträge. Ein Gerät, das bei erreichbarem Gateway nicht meldet, bleibt ein eigener kritischer Eintrag.
4. **Zählung:** Der Zähler zählt Einträge nach Unterdrückung (jedes betroffene Gerät eins, das Gateway eins). Gruppierung ist Darstellung und ändert die Zahl nicht.
5. **Hero-Limit:** höchstens drei Gruppenzeilen, darunter immer der Button „Alle N Hinweise“ mit „n weitere Gruppen“, wenn Gruppen fehlen. Kopf „Braucht Aufmerksamkeit · N“, rechts „k kritisch“ nur bei k > 0.
6. **Farbe:** Hero in `primary-container`, solange nichts Kritisches offen ist; `error-container` ab dem ersten kritischen Eintrag. Einträge liegen als `surface-container-lowest`-Pods im Hero, Text in `on-surface`. Die Art zeigt der Icon-Container: kritisch `error`/`on-error`, zu trocken `dry-container`, zu nass `wet-container`, Batterie `warning-container`, Hinweis `secondary-container`; kritische Einträge tragen das Label „Kritisch“.
7. **Ruhezustand:** ohne Einträge zeigt der Block die Ruhezeile (56 px) mit ok-Icon-Container und Link zu „Alle Hinweise“. Der Block ist über „Übersicht anpassen“ ausblendbar; **ein kritischer Eintrag zeigt den Hero immer**.
8. **Raumkarten spiegeln den Status:** Chip „n Hinweise“ in der Farbe der höchsten Art im Raum, sonst „n Geräte · alles ok“; Pods tragen ihren Status-Chip.
9. **„Alle Hinweise“ ist eine Seite** (Abschnitt 3.4), kein Sheet. Quittieren und Stummschalten kommen später.

### 4.2 Arten, Bedingungen und Sichtbarkeit

| Art (`kind`)      | Dringlichkeit | Bedingung                                                                                                                          | Sichtbar für           |
| ----------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `gateway_offline` | `critical`    | `bridge_status` oder `z2m_status` länger als 5 min nicht `online` (Benachrichtigung in Etappe 7 nach 15 min, Architektur-Spec 8.8) | alle                   |
| `device_silent`   | `critical`    | Gateway online und `availability` `offline`, oder keine Meldung länger als die Schwelle (Abschnitt 4.3, Standard 2 h)              | alle                   |
| `soil_dry`        | `warning`     | das Gerät meldet „trocken“ (Flag der Fähigkeit) oder `soil_moisture` unter der unteren Schwelle (Abschnitt 4.3, Standard 25 %)     | alle                   |
| `soil_wet`        | `warning`     | `soil_moisture` über der oberen Schwelle (Abschnitt 4.3; Standard: keine, also aus, bis sie gesetzt ist)                           | alle                   |
| `battery_low`     | `warning`     | Batterie unter der Schwelle (Abschnitt 4.3, Standard 20 % = `LOW_BATTERY_PERCENT`)                                                 | alle                   |
| `contact_open`    | `info`        | `contact` offen länger als die Schwelle (Abschnitt 4.3, Standard 10 min)                                                           | alle                   |
| `hardware_new`    | `info`        | erkannte, nicht zugeordnete Hardware                                                                                               | owner                  |
| `cert_expiring`   | `info`        | Zertifikat oder CRL läuft in weniger als 30 Tagen ab                                                                               | owner, Plattform-Admin |

Ein Eintrag entsteht, sobald die Bedingung gilt, und verschwindet, sobald sie nicht mehr gilt; `since` ist der Zeitpunkt, ab dem sie gilt. Hysterese nur dort, wo Werte flattern: `soil_dry` endet erst 3 Prozentpunkte über der unteren Schwelle, `soil_wet` 3 Prozentpunkte unter der oberen, `battery_low` 5 Prozentpunkte über ihrer Schwelle.

### 4.3 Schwellen: je Geräteart voreingestellt, pro Gerät anpassbar

- **Standardwerte je Geräteart** (`deviceKind`, Abschnitt 2.4) stehen in `@smart/contracts` (`DEFAULT_THRESHOLDS`), zum Beispiel `soil`: Feuchte unten 25 %, oben aus; alle batteriebetriebenen Arten: Batterie 20 %; `contact`: offen länger als 10 min; alle Arten: stumm nach 2 h. Für Gateways gilt fest 5 min (keine Anpassung in 6b).
- **Je Gerät überschreibbar:** `devices.thresholds` (JSON, nur gesetzte Werte; fehlender Wert = Standard der Art). Die effektive Schwelle ist `Gerät ?? Art`. Ändern dürfen `owner` und `member` (wie Umbenennen); `viewer` sieht die Werte. `PATCH /api/v1/households/:id/devices/:deviceId` nimmt `thresholds` mit zod-Grenzen (Prozent 0–100, untere < obere Feuchte, Dauer 1 min–7 Tage); `null` für einen Wert setzt ihn auf den Standard zurück.
- **Oberfläche:** auf der Geräteseite eine Karte „Grenzwerte“ mit den Werten, die für die Fähigkeiten des Geräts gelten (Feuchte unten/oben, Batterie, offen länger als, stumm nach); jeder Wert zeigt, ob er der Standard der Art ist („Standard“) oder angepasst, mit „Auf Standard zurücksetzen“. Das Band „zu trocken“ im Diagramm (6c) folgt der effektiven unteren Schwelle.
- `core/attention` liest die effektiven Schwellen; eine Änderung wirkt sofort (neu berechnen für das Gerät). Das Pflanzenmodul (Etappe 8) kann später Standardwerte je Pflanzenart liefern; eine Anpassung am Gerät hat weiter Vorrang.

### 4.4 Berechnung im Backend

Neues Core-Modul `core/attention` berechnet die Einträge je Haushalt aus `gateways`, `devices`, `device_state` und `hardware` (über deren `index.ts`), hält sie im Speicher und schreibt sie nicht in die Datenbank (sie sind aus dem Zustand ableitbar). Gründe: Die Unterdrückung (Regel 3) und die Zeitbedingungen brauchen den Gesamtzustand des Haushalts und eine Uhr, die unabhängig vom offenen Browser läuft; Etappe 7 verschickt Benachrichtigungen für dieselben Bedingungen (Architektur-Spec 8.8, Core-Meldungen) und darf nicht zu anderen Ergebnissen kommen als die App; Feature-Module (Pflanzen) registrieren später eigene Arten, ohne dass die App sie kennt. Die App gruppiert, sortiert und begrenzt nur für die Darstellung (Regeln 2, 4, 5).

- `GET /api/v1/households/:id/attention` (viewer): `{ items: AttentionItem[] }`, nach Rolle gefiltert.
- `AttentionItem` in `@smart/contracts`: `id`, `kind`, `severity`, `since` (UTC), `deviceId?`, `gatewayId?`, `roomId?`, `name`, `value?`, `unit?`, `params` (z. B. `affectedDevices`).
- SSE-Ereignis `attention.changed` (neu in Architektur-Spec 8.7) mit dem vollständigen Stand des Haushalts; die App ersetzt ihren Stand.
- Die Übersicht verwendet außerdem: Haushalt (Name), Gateways (Status, `status_changed_at`, `last_message_at`), Geräte (6a, mit `room_id` ab 6c), Räume mit Gerätereihenfolge (6c), die Anpassung (Abschnitt 5). Bis zur SSE-Anbindung in 6c gilt das 6a-Muster: Laden beim Öffnen und alle 60 s.

## 5. Übersicht anpassen

- **Blöcke:** `status` (Status-Hero/Ruhezeile), `devices` (Pods aller Geräte; 6b), `rooms` (Raumkarten; 6c), `gateway` (Gateway-Zeile mit Status und letzter Meldung). Feature-Module können Blöcke über `provideFeature({ overviewBlocks })` registrieren (ersetzt `overviewCards`): `id`, `labelKey`, `descriptionKey`, `icon`, `defaultVisible`, `defaultOrder`, Komponente oder Lader.
- **Speicherort:** je User und Haushalt in `memberships.overview_layout` (JSON `{ blocks: [{ id, visible }] }`, Reihenfolge = Reihenfolge im Array). Grund: Die Übersicht ist eine persönliche Sicht auf einen bestimmten Haushalt – ein Mitglied mehrerer Haushalte will je Haushalt anderes sehen, und niemand verändert mit seiner Einstellung die Ansicht anderer. Das Theme bleibt je User (Architektur-Spec 10.5), weil es den Menschen betrifft, nicht den Haushalt.
- **API:** `GET`/`PUT /api/v1/households/:id/me/overview-layout` (viewer; jedes Mitglied darf seine Sicht anpassen), `DELETE` setzt zurück.
- **Standard:** `status`, `rooms` (ab 6c; in 6b `devices`), `gateway` aus. Unbekannte Block-IDs in der gespeicherten Liste werden ignoriert, neue Blöcke mit `defaultVisible` hinten angefügt.
- **Zurücksetzen:** löscht den Eintrag; die App zeigt den Standard. Regel 7 gilt unabhängig davon.

## 6. Warnfarbe

Heute übernimmt `warning` die `error`-Rollen (`packages/theme/src/status.ts`); Grund laut Kommentar: Rot, Orange und Amber (`dry`) fallen bei den Tönen, die weiße Schrift braucht, zusammen. Für die neue Sprache ist das tragbar, weil Dringlichkeit nie nur über Farbe kommt (Abschnitt 8), aber „Batterie schwach“ und „Gateway offline“ sollten sich unterscheiden lassen. Deshalb:

- **Spike (6b, höchstens ein Tag):** `warning` als eigene Palette mit Quellfarbe um HCT-Hue 50 (Orange), harmonisiert wie `dry`, `ok`, `wet` (höchstens 8°). Abnahme: in allen sechs Modus-Kontrast-Kombinationen und mit drei Grundfarben (Standard, Rot, Gelb) gilt: Hue-Abstand nach Harmonisierung zu `error` und zu `dry` mindestens 18°; `on-*`-Rollen mindestens 4,5:1 auf ihrer Fläche; `warning-container` von `error-container` und `dry-container` im Storybook-Vergleich ohne Legende unterscheidbar (Till entscheidet).
- **Bei Erfolg:** `warning` wird vierte harmonisierte Statusfarbe, `STATUS_SOURCES` erhält den Eintrag, der Kommentar in `status.ts` wird ersetzt; Standard-CSS neu erzeugt. Bestehende Verwendungen (Batterie niedrig in 6a, Gateway-Warnungen) wechseln automatisch mit, weil sie die Rollen `--smart-status-warning*` nutzen; nichts referenziert `error` für Warnungen direkt.
- **Bei Scheitern:** alles bleibt; die Spec-Regel 6 funktioniert trotzdem (Icon, Label, Position).

## 7. Komponenten in `@smart/ui`

Alle neuen Bausteine nur in `public-api.ts` oder `forms.ts`, nie in `shell.ts`; ECharts und das Bottom Sheet laden als eigene Chunks per `import()`. Nach jedem Baustein `pnpm build` und die Größe des initialen Bundles prüfen (Grenze 480 kB, Stand rund 472,7 kB). Texte: einfache Bausteine über Inputs, zusammengesetzte mit eigenen `ui.*`-Schlüsseln.

| Baustein           | Zweck                                                                          | Inputs / Outputs                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `ui-status-hero`   | Status-Block: Hero oder Ruhezeile                                              | `tone` (`calm`/`attention`/`critical`), `heading`, `count`, `criticalCount`, `moreLabel`, `moreRoute`; Inhalt: Einträge |
| `ui-status-entry`  | Eintrag im Hero und in „Alle Hinweise“                                         | `icon`, `kindTone` (Statusfarbe oder Rolle), `title`, `subtitle`, `value`, `severityLabel`, `route`                     |
| `ui-device-pod`    | Geräte-Pod, Link oder Schalter                                                 | `kind`, `icon`, `value`, `label`, `chip` (`{ text, tone }`), `route` oder `pressed` + `pending`; Output `toggled`       |
| `ui-pod-row`       | horizontale Reihe mit Snap, Tastatur, Pfeilen ab Medium; umbrechend per `wrap` | `wrap`                                                                                                                  |
| `ui-room-card`     | Raumkarte mit Kopf und Pod-Reihe                                               | `heading`, `route`, `summary` (`{ text, tone? }`); Inhalt: `ui-pod-row`                                                 |
| `ui-value-display` | Wert mit Einheit und Label in drei Größen                                      | `value`, `unit`, `label`, `size` (`hero`/`large`/`medium`), `tone`                                                      |
| `ui-progress-band` | Fortschrittsleiste mit markiertem Bereich                                      | `value`, `min`, `max`, `band` (`{ from, to, tone }`)                                                                    |
| `ui-chart`         | ECharts-Kapselung (lazy), Farben aus Tokens                                    | `series`, `kind` (`bar`/`line`), `band`, `unit`, `description` (Textalternative); Zeitachse in Haushaltszone            |
| `ui-chip-set`      | erweitert: Zähler je Chip, Mehrfachauswahl                                     | `options[].count`, `multiple`                                                                                           |
| `ui-reorder-list`  | Liste mit Ziehgriff und Tastaturverschiebung (CDK Drag-Drop)                   | `items`, Output `reordered`; Inhalt je Zeile über Template                                                              |
| `UiBottomSheet`    | Service für Sheets (Compact) und Dialoge (ab Medium)                           | `open(component, data)`                                                                                                 |
| `ui-icon-button`   | erweitert: Variante `tonal`                                                    | `variant`                                                                                                               |
| `ui-top-app-bar`   | erweitert: großer Titel auf Compact                                            | `size` (`small`/`large`)                                                                                                |
| `ui-list-item`     | erweitert: Icon-Container in einer Rolle oder Statusfarbe                      | `leadingTone`                                                                                                           |

Feature-Code enthält weiterhin kein CSS; was fehlt, wird ein `ui-*`-Baustein. Material bleibt Implementierungsdetail der Bibliothek (Switch, Slider, Bottom Sheet, Dialog, Drag-Drop).

## 8. Barrierefreiheit

- Ziel WCAG 2.2 AA; Text 4,5:1, große Werte und Icons 3:1; die Generator-Rollen garantieren das für `on-*` auf ihrer Fläche, Storybook prüft es mit axe hell und dunkel (Abschnitt 2.7).
- Touch-Ziele mindestens `--smart-size-touch` (48 px), auch Chips (40 px sichtbar, 48 px Ziel) und Ziehgriffe.
- Farbe ist nie der einzige Träger: Dringlichkeit über Position, Label „Kritisch“ und Icon; Zustände über Chip-Text („trocken“, „Aus“) oder Icon; Diagramme mit Band **und** Beschriftung.
- Screenreader: Pod als Link oder Schalter mit `aria-label` „Monstera, Bodenfeuchte 46 Prozent, in Ordnung“ beziehungsweise „Deckenlampe, an, 80 Prozent; ausschalten“; Hero als `region` mit Überschrift; neuer kritischer Eintrag wird über `UiAnnouncer` (`assertive`) angesagt, andere Änderungen `polite`; Diagramm mit `description` als Textzusammenfassung und Link „Werte als Tabelle“.
- Tastatur: Pod-Reihen per Tab erreichbar, der fokussierte Pod scrollt ins Bild; Sheet mit Fokusfalle und Escape; Verschieben mit Pfeiltasten.
- `prefers-reduced-motion`, `prefers-contrast` und `prefers-color-scheme` werden respektiert (Abschnitt 2.6, Architektur-Spec 10.5).

## 9. Reihenfolge und Umfang

| Etappe                            | Inhalt                                                                                                                                                                                                                                                                                                                                                                                      | Sichtbares Ergebnis                                                                                     |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 6b Designsprache                  | Tokens (2.1–2.6), Warnfarben-Spike (6), `deviceKind` in Contracts, Bausteine aus 7 (ohne `ui-chart`, `ui-room-card`), `core/attention` mit den Arten aus 4.2 und den Schwellen aus 4.3 (Standardwerte, Anpassung je Gerät, Karte „Grenzwerte“), Übersicht mit Hero und Block „Geräte“, „Alle Hinweise“, „Übersicht anpassen“ mit Speicherung, Umbau der bestehenden Seiten (3.6), Storybook | Die App sieht aus wie Richtung B; der Status-Block zeigt echte Hinweise des Simulators und der Sensoren |
| 6c Räume, Verläufe, Live, Befehle | Räume (Modell, Seiten, Block `rooms`, Pods je Raum), Stundenaggregat und `ui-chart`, SSE inklusive `attention.changed`, Befehle mit Lampen-Pod und Geräteseite der Lampe, Kopplungsmodus – alles in der Sprache aus 6b                                                                                                                                                                      | Räume mit Pods, Verläufe mit Band, Lampe schaltbar aus der Übersicht                                    |

Tests: Storybook-Stories je Baustein hell und dunkel mit axe (Abschnitt 2.7); Unit-Tests für Gruppierung, Zählung und Hero-Limit (App) und für die Regeln 1–4 und Hysterese (`core/attention`, Integrationstest mit dem Simulator: Gateway offline erzeugt genau einen Eintrag); E2E: Übersicht zeigt Hero mit Simulator-Hinweisen, Anpassung bleibt nach Neuladen erhalten.

## 10. Nicht-Ziele und später

Quittieren und Stummschalten von Hinweisen; Favoriten (Block `favorites`, braucht eine Markierung je User und Gerät); Wetter (keine Datenquelle); Szenen; Theme je Haushalt; Standardwerte je Pflanzenart (Pflanzenmodul, Etappe 8); anpassbare Gateway-Schwelle; Benachrichtigungen und Web-Push (Etappe 7); eine zweite Display-Schrift (Richtung C, verworfen).
