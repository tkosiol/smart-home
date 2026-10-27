# Etappe 6c-2: Live-Aktualisierung – Design

- Status: freigegeben (Till, 2026-10-27, im Chat: „schreib den plan und setze um“; Umfang „Werte + Hinweise + Verlauf“, Ansatz „Ereignisse mit Daten“)
- Bezug: Architektur-Spec 8.7 (Live-Updates), 8.9 (API); ADR-0010 (SSE); Designkonzept 4.4 (Hinweise), Abschnitt „Daten“ (60-s-Muster bis zur SSE-Anbindung); Etappe 6c-1 (Verlaufskarte)

## 1. Ziel

Was die App zeigt, aktualisiert sich ohne Neuladen und ohne Polling:

- aktuelle Werte in Geräte-Pods, Geräteliste und Geräteseite,
- die Hinweise (Status-Hero, „Alle Hinweise“),
- Gateway-Status (Block der Übersicht, Gateway-Seite),
- neu erkannte Hardware („Neu erkannt“),
- der Verlauf auf der Geräteseite.

**Nicht in 6c-2:** `command.result` (kommt mit den Befehlen), `notification.created` (kommt mit den Benachrichtigungen), `device.removed` (Geräte lassen sich noch nicht löschen; das Ereignis kommt mit dem Löschen), eine Anzeige „nicht live“. Die Mitgliederseite lädt weiterhin nur beim Öffnen und auf Nutzeraktion (sie hat nie gepollt); für Mitgliedschaften gibt es kein Ereignis.

## 2. Ereignisse (`@smart/contracts`)

Jedes Ereignis trägt dasselbe Objekt, das der passende REST-Endpunkt liefert; die App ersetzt es per ID, ohne nachzufragen. Nach jedem (Neu-)Verbinden lädt sie den Stand einmal per REST (Abschnitt 4.2).

| Ereignis            | Daten                                 | Empfänger                         | Auslöser                                                                                                                                                 |
| ------------------- | ------------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `device.state`      | `Device` (wie `GET devices/:id`)      | ab `viewer`                       | neuer Messwert, Verfügbarkeit, Name, Symbol, Schwellwerte, Gerät angelegt                                                                                |
| `gateway.status`    | `Gateway` (wie `GET gateways`)        | `owner`                           | Status von Bridge oder Z2M geändert, Gateway registriert, widerrufen, neue Meldung (höchstens einmal pro Minute, wie `last_message_at` gespeichert wird) |
| `hardware.updated`  | `Hardware` (wie `GET hardware`)       | `owner`                           | freie Hardware neu erkannt, Interview-Stand, umbenannt, Verfügbarkeit, Zustand                                                                           |
| `hardware.removed`  | `{ id }`                              | `owner`                           | Hardware einem Gerät zugeordnet oder vom Netz abgemeldet                                                                                                 |
| `attention.changed` | `AttentionList` (wie `GET attention`) | ab `viewer`, nach Rolle gefiltert | Hinweisliste des Haushalts hat sich nach einer Neuberechnung tatsächlich geändert                                                                        |

- Die Empfänger folgen den Rollen der REST-Endpunkte: Gateways und freie Hardware liest nur `owner`, Geräte und Hinweise jedes Mitglied. `attention.changed` filtert wie `GET attention` (`cert_expiring` nur für Besitzer und Plattform-Admins).
- **Drosselung:** je Objekt (Ereignistyp + ID, bei `attention.changed` der Haushalt) höchstens ein Ereignis pro Sekunde. Fällt ein Auslöser in eine laufende Sekunde, geht nach ihrem Ende genau ein Ereignis mit dem dann aktuellen Stand raus. Zigbee-Geräte mit Strommessung melden sich alle paar Sekunden.
- **Schemas:** `liveEventSchema` als diskriminierte Union über `type` mit den vorhandenen Schemas (`deviceSchema`, `gatewaySchema`, `hardwareSchema`, `attentionListSchema`); Typ `LiveEvent`, Konstante `LIVE_EVENT_TYPES`.
- **Leitung** (`text/event-stream`, UTF-8), je Ereignis ein Block; Heartbeat als Kommentar:

  ```
  event: device.state
  data: {"id":"…","name":"Monstera",…}

  : ping

  ```

## 3. Backend

### 3.1 Modul `core/live`

Neues Core-Modul; importiert `core/devices`, `core/gateways`, `core/attention`, `core/households` und `core/identity` nur über deren `index.ts`. Keines dieser Module kennt `core/live`.

**`LiveController`** – `GET /api/v1/households/:householdId/events`

- `@UseGuards(HouseholdGuard)`, `@RequireRole('viewer')`: ohne Session 401, ohne Mitgliedschaft 404 (`household.notFound`), wie bei REST.
- Schreibt den Stream selbst in die Response (kein `@Sse`), damit Heartbeat-Kommentare und gezieltes Schließen möglich sind.
- Header: `Content-Type: text/event-stream; charset=utf-8`, `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`. Erste Zeile `: connected`, damit Proxys und Client den Stream sofort als offen sehen.
- Meldet die Verbindung beim `LiveHub` an; schließt der Client, meldet er sie ab.

**`LiveHub`** – offene Verbindungen

- Hält je Haushalt die Verbindungen mit Nutzer, Session und Rolle.
- `publish(householdId, event, minRole)` schreibt an alle Verbindungen des Haushalts, deren Rolle reicht; `publishByRole(householdId, build: (role) => event)` baut das Ereignis einmal je vorkommender Rolle (für `attention.changed`).
- **Heartbeat alle 25 s** (`: ping`) und dabei Prüfung von Session (gültig, nicht abgelaufen) und Mitgliedschaft. Ist eines davon weg, schließt der Hub den Stream; eine geänderte Rolle gilt ab dieser Prüfung.
- **Voller Puffer:** Gibt `res.write` `false` zurück, schließt der Hub diese Verbindung, statt Ereignisse aufzustauen; die App verbindet neu und lädt per `resync`.
- `onModuleDestroy` schließt alle Streams (die API läuft mit `enableShutdownHooks`).

**`LivePublisher`** – aus internen Ereignissen werden Live-Ereignisse

- Hört auf die Ereignisbusse von `core/devices`, `core/gateways` und `core/attention`; baut das DTO **einmal je Ereignis**, nicht je Verbindung, und übergibt es dem Hub.
- Setzt die Drosselung aus Abschnitt 2 um (Timer je Schlüssel; der Stand wird erst nach Ablauf gebaut).
- Ein Fehler beim Bauen (z. B. DB kurz weg) wird protokolliert und das Ereignis verworfen; der nächste Wechsel oder das nächste `resync` holt es nach. Der Publisher hört nur zu und hält weder Ingest noch Hinweisberechnung auf.
- Ein Objekt, das es inzwischen nicht mehr gibt (z. B. Gateway gelöscht), ergibt kein Ereignis.

### 3.2 Interne Ereignisse, die dazukommen

- **`core/devices` – Gerät geändert:** `DEVICE_CHANGED { householdId, deviceId }` bei Messwert-Zustand (an der Stelle des vorhandenen `DEVICE_STATE_CHANGED`, das dafür ebenfalls die `householdId` bekommt), Verfügbarkeit der zugeordneten Hardware, Anlegen und `PATCH` (Name, Symbol, Schwellwerte). `DEVICE_STATE_CHANGED` und `DEVICE_THRESHOLDS_CHANGED` bleiben für `core/attention` unverändert in ihrer Bedeutung.
- **`core/devices` – Hardware geändert:** `HARDWARE_CHANGED { gatewayId, hardwareId }` aus den schreibenden Methoden des Hardware-Repositorys bzw. ihren Aufrufern (Erkennen/Upsert, Beitritt, Interview, Abmelden, Umbenennen, Verfügbarkeit, Zustand) und beim Zuordnen zu einem Gerät. Der Publisher ermittelt den Haushalt über das Gateway und entscheidet:
  - Hardware frei und nicht abgemeldet → `hardware.updated`,
  - zugeordnet oder abgemeldet → `hardware.removed`,
  - ändert sich die Verfügbarkeit zugeordneter Hardware, kommt das Gerät über `DEVICE_CHANGED`.
- **`core/gateways`:** Die vorhandenen Ereignisse `gateway.status-changed`, `gateway.registered` und `gateway.revoked` reichen; der Publisher lädt das `Gateway` des Haushalts.
- **`core/attention`:** Nach jeder Neuberechnung eines Haushalts vergleicht der Service die neue Hinweisliste mit der vorherigen (ungefiltert, Reihenfolge wie `list()`); nur bei einem Unterschied meldet er `ATTENTION_CHANGED { householdId }`. Der Publisher ruft `list()` je vorkommender Rolle auf.

### 3.3 Infrastruktur

- Web-nginx (`apps/frontend/nginx/default.conf`): unverändert. `proxy_buffering off`, `proxy_read_timeout 1h` und `proxy_http_version 1.1` sind gesetzt; gzip erfasst `text/event-stream` nicht.
- Nginx Proxy Manager davor: Pufferung über `X-Accel-Buffering: no`.
- Bricht ein Stream nach einer Stunde am Proxy ab, verbindet die App neu (Abschnitt 4.1); das ist vorgesehen.
- Backend ohne Kompression (unverändert).

## 4. Frontend

### 4.1 `core/live` (Startcode)

- **Verbindung per `fetch`** (`credentials: 'same-origin'`, `Accept: text/event-stream`, Header `ngsw-bypass: true`) und Lesen des `ReadableStream` mit einem eigenen kleinen SSE-Parser (Felder `event`, `data` auch mehrzeilig, Kommentare, Chunks an beliebiger Stelle getrennt). Kein `EventSource`: es kann eine 401 nicht erkennen.
- **401 `auth.required`** geht an den `UNAUTHORIZED_HANDLER`, wie im `ApiClient`.
- **Keine Laufzeitprüfung** der Ereignisse mit Zod (wie der `ApiClient` bei Antworten); Typen aus `@smart/contracts`.
- **Wann offen:** solange mindestens ein Abonnent da ist, ein Haushalt gewählt ist und der Tab sichtbar ist. Unsichtbar → Stream schließen; wieder sichtbar → neu verbinden. Haushaltswechsel → schließen und mit dem neuen Haushalt verbinden.
- **Neu verbinden** nach Abbruch, Netzfehler, 5xx oder einer Antwort, die kein `text/event-stream` ist: Wartezeit 1 s, 2 s, 4 s … höchstens 30 s, je ±20 % Zufall; nach einem erfolgreichen Verbinden wieder ab 1 s. Keine Meldung, die Seite hat Daten.
- **403 oder 404:** kein weiterer Versuch, bis sich der Haushalt ändert (das Laden der Seite zeigt den Fehler ohnehin).
- **Größe:** Ziel 2–3 kB im initialen Bundle; Grenze 425 kB, gemessen mit `pnpm build`. Keine Symbole aus `@angular/core`, die das Bundle sichtbar vergrößern (`resource()` u. Ä.).

### 4.2 Anbindung in den Features

`injectLive(handlers)` im Injection-Kontext; das Abo endet mit dem `DestroyRef`.

```ts
injectLive({
  'device.state': (device) => devices.upsert(device),
  resync: () => devices.load(currentId(), true),
});
```

- **`resync`** läuft nach jedem Verbinden, bei dem der Abonnent schon da war (also nach jedem Neuverbinden und nach dem ersten Verbinden, wenn die Seite vor dem Stream geladen hat). Kommt eine Seite zu einem schon offenen Stream hinzu, gibt es kein `resync`: ihr eigenes erstes Laden liegt danach.
- **`LoadedList`** bekommt `upsert(item)` (ersetzen per `id`, sonst anhängen) und `remove(id)`. Beide wirken nur, wenn die Liste geladen ist (`loaded()`), sonst überschreibt die laufende Ladung ohnehin alles.

| Stelle                                  | Ereignis                                | Wirkung                                                                                                      |
| --------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Geräteliste und Pods (`device-list.ts`) | `device.state`                          | `upsert`                                                                                                     |
| Geräteseite (`device-page.ts`)          | `device.state` mit eigener ID           | `device` ersetzen                                                                                            |
| Verlaufskarte (`history-card.ts`)       | `device.state` mit eigener ID           | gewählten Zeitraum neu laden, höchstens einmal pro Minute; ein Auslöser in der Pause lädt am Ende der Minute |
| Hinweise (`attention.ts`)               | `attention.changed`                     | Liste ersetzen; die Ruhezeile übernimmt aus `device.state` das neueste `lastSeenAt`                          |
| Gateway-Block und Gateway-Seite         | `gateway.status`                        | `upsert`                                                                                                     |
| Neu erkannt (`new-hardware.ts`)         | `hardware.updated` / `hardware.removed` | `upsert` / `remove`; Eingaben (Namen) zu einer entfernten Hardware fallen weg                                |

- **Polling entfällt** an diesen Stellen: `refreshWhileVisible` wird dort nicht mehr aufgerufen, ebenso die 5-Minuten-Aktualisierung der Verlaufskarte (`HISTORY_REFRESH_MS`). `refreshWhileVisible` und `REFRESH_MS` sind entfernt (die Mitgliederseite hat nie gepollt).
- Relative Zeiten („vor 3 Min.“) tickt weiter die `UiClock` (alle 30 s); sie hängen nicht am Nachladen.
- **Ausfall:** Ist der Stream länger getrennt, zeigt die App den zuletzt bekannten Stand.

## 5. Tests

- **Contracts:** `liveEventSchema` nimmt jedes Ereignis an und lehnt unbekannte Typen und falsche Daten ab.
- **Backend, Unit:**
  - Hub: Verteilen nach Rolle, `publishByRole` baut je Rolle einmal, Heartbeat, Schließen bei abgelaufener Session und entfernter Mitgliedschaft, Rolle ändert sich beim Heartbeat, voller Puffer schließt, `onModuleDestroy` schließt alle.
  - Publisher: Drosselung je Schlüssel (letzter Stand gewinnt, ein Ereignis je Sekunde), Hardware frei/zugeordnet/abgemeldet, DTO einmal je Ereignis, Fehler beim Bauen verwirft nur dieses Ereignis.
  - Attention: meldet nur bei geänderter Liste, nicht bei gleicher.
- **Backend, Integration** (Testcontainers, echter HTTP-Stream): Messwert per MQTT → `device.state` beim Betrachter; `gateway.status` nur beim Besitzer, nicht beim Betrachter; fremder Nutzer 404, ohne Session 401; Header und `: connected`.
- **Frontend, Unit:** SSE-Parser (zerstückelte Chunks, mehrzeiliges `data`, Kommentare, `\r\n`); Live-Dienst (Backoff mit Grenze, Sichtbarkeit, Haushaltswechsel, 401 an den Handler, 403/404 ohne neuen Versuch, `resync` nur nach Neuverbinden); `LoadedList.upsert`/`remove`; je Stelle aus 4.2 ein Spec, dass das Ereignis die Anzeige ändert; Verlaufskarte lädt gedrosselt.
- **Stack-E2E:** Simulator meldet alle 5 s; Geräteseite eines Bodensensors offen, ohne Neuladen ändert sich der angezeigte Wert. Deckt nginx (Pufferung, Header) mit ab.
- **Bundle:** initial unter 425 kB, Stand in `CLAUDE.md` nachgeführt.

## 6. Doku

- Architektur-Spec 8.7: Nachtrag mit den Ereignissen aus Abschnitt 2 (Empfänger nach Rolle, Drosselung, Wegfall von `device.availability` – steckt in `device.state` – und `hardware.discovered` – ersetzt durch `hardware.updated`/`hardware.removed`), Client per `fetch` statt `EventSource`.
- ADR-0010: Nachtrag „Client per `fetch` statt `EventSource`“ (401-Erkennung; eigenes Neuverbinden mit Backoff statt Auto-Reconnect des Browsers).
- Designkonzept, Abschnitt „Daten“: „Bis zur SSE-Anbindung …“ durch den Stand ab 6c-2 ersetzen.
- `CLAUDE.md`: Bundle-Stand; sonst nur, falls sich Befehle oder Regeln ändern.
