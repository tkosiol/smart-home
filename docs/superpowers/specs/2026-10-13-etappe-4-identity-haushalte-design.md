# Etappe 4: Identity und Haushalte – Spec

|        |                                                                                                                                                 |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Status | Entwurf zur Freigabe                                                                                                                            |
| Datum  | 2026-10-13                                                                                                                                      |
| Bezug  | Architektur-Spec Abschnitte 7, 8.4, 8.9, 8.11; ADR-0007, ADR-0008, ADR-0009, ADR-0018; Übertrag aus Plan 3d (Abschnitt „Ergebnis und Übertrag“) |

## 1. Ziel

Nach Etappe 4 meldet man sich ohne Passwort an (E-Mail-Code, Passkey), verwaltet Sessions und Passkeys selbst, legt Haushalte an, lädt Mitglieder mit Rollen ein und behält Theme und Sprache auf allen Geräten. Das Instanz-Theme verwaltet der Plattform-Admin in der App. Geräte, Gateways und Räume folgen ab Etappe 5/6; Etappe 4 liefert dafür Mandantentrennung und Rollenprüfung.

## 2. Aufteilung

Eine Spec, drei Pläne. Reihenfolge (Entscheidung 2026-10-13): **4a → 4c → Etappen 5–8 → 4b**. Passkeys kommen ans Ende, damit die Pflanzensensoren früher in der App erscheinen; bis dahin ist der E-Mail-Code der einzige Anmeldeweg. Als Notbremse ohne Sicherheitsseite liefert 4c den CLI-Befehl `revoke-sessions --email <e>` (beendet alle Sessions des Users).

| Plan                          | Inhalt                                                                                                                                                                                                                                   | Sichtbares Ergebnis                                               |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 4a Fundament und E-Mail-Login | Bundle-Platz, Rahmen als Layout-Route, HTTP-Client und Fehlerformat, `users`/`sessions`/`email_login_codes`, Mailversand (SMTP), CLI `create-admin`, Anmelden per Code, Abmelden, `/api/v1/me`, Theme und Sprache am User, Offline-Start | Till legt sich per CLI an und meldet sich auf Staging per Code an |
| 4b Passkeys und Sicherheit    | Passkey anlegen und anmelden (auch geräteübergreifend per QR), Sicherheitsseite (Passkeys, Sessions), Info-Mail „Neue Anmeldung“, CLI `recovery-link`, Hinweis bei unsicherem Kontext                                                    | Anmelden per Passkey; Sessions anderer Geräte beenden             |
| 4c Haushalte und Rollen       | Einrichtungsseite, Haushaltswechsler, Haushaltseinstellungen (Name, Zeitzone), Mitglieder, Rollen, Einladungen, Instanz-Theme in der DB, rollenabhängige „Mehr“-Einträge                                                                 | Familie einladen; Rollen wirken; Zeiten in Haushalts-Zeitzone     |

## 3. Backend

### 3.1 Module

- `platform/mail`: Schnittstelle `MailSender`, ein Adapter `SmtpMailSender` (nodemailer) für alle Umgebungen. Templates (Betreff, Text, einfaches HTML) je Sprache `de`/`en`. Staging versendet nur an Adressen der Freigabeliste; andere werden protokolliert (maskiert) und verworfen.
- `core/identity`: User, Sessions, E-Mail-Code, Passkeys, WebAuthn-Challenges, Recovery-Links, persönliche Einstellungen.
- `core/households`: Haushalte, Mitgliedschaften, Einladungen, Instanz-Einstellungen.
- CLI `apps/backend/src/cli.ts` (im API-Image als `node dist/cli.js`): `create-admin --email <e> --name <n>` (4a), `revoke-sessions --email <e>` (4c), `recovery-link --email <e>` (4b). Auf dem VPS über ein Skript im Deploy-Ordner; nur Till führt es aus.
- Querschnitt: `SessionGuard` (global, Ausnahmen per `@Public()`), `@RequireRole('viewer'|'member'|'owner')` für Haushaltspfade, `@RequirePlatformAdmin()`, Origin-Prüfung, Rate-Limits (`@nestjs/throttler`), Fehlerformat `{ code, params, traceId }`.

### 3.2 Datenmodell (Drizzle-Migrationen)

| Tabelle               | Felder                                                                                                                                                                                                                                     | Plan                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------- |
| `users`               | `id` (uuid), `email` (eindeutig, kleingeschrieben gespeichert), `display_name`, `locale` (`de`/`en`), `appearance` (JSON nach `personalAppearanceSchema`), `is_platform_admin`, `last_household_id` (nullable), `created_at`, `updated_at` | 4a (`last_household_id` 4c) |
| `sessions`            | `id`, `token_hash` (eindeutig), `user_id`, `auth_method` (`email_code`/`passkey`/`recovery`/`invitation`), `user_agent`, `created_at`, `last_seen_at`, `expires_at`, `absolute_expires_at`, `revoked_at`                                   | 4a                          |
| `email_login_codes`   | `id`, `email`, `code_hash`, `browser_nonce_hash`, `attempts`, `expires_at`, `used_at`, `created_at`                                                                                                                                        | 4a                          |
| `passkeys`            | `id`, `user_id`, `credential_id` (eindeutig), `public_key`, `counter`, `transports`, `name`, `created_at`, `last_used_at`                                                                                                                  | 4b                          |
| `webauthn_challenges` | `id`, `challenge`, `browser_nonce_hash`, `user_id` (nullable), `purpose` (`register`/`login`), `expires_at`                                                                                                                                | 4b                          |
| `recovery_tokens`     | `id`, `user_id`, `token_hash`, `expires_at`, `used_at`                                                                                                                                                                                     | 4b                          |
| `households`          | `id`, `name`, `timezone` (IANA), `created_at`                                                                                                                                                                                              | 4c                          |
| `memberships`         | `household_id`, `user_id`, `role` (`viewer`/`member`/`owner`), `created_at`; PK (`household_id`, `user_id`)                                                                                                                                | 4c                          |
| `invitations`         | `id`, `household_id`, `email`, `role`, `token_hash`, `invited_by`, `created_at`, `expires_at`, `accepted_at`, `revoked_at`                                                                                                                 | 4c                          |
| `instance_settings`   | `id` (immer 1), `appearance` (JSON nach `instanceAppearanceSchema`, nullable), `updated_at`, `updated_by`                                                                                                                                  | 4c                          |

Alle Geheimnisse (Session-Token, Codes, Nonces, Einladungs- und Recovery-Tokens) nur als SHA-256-Hash. Ein täglicher Job löscht abgelaufene Codes, Challenges, Tokens und Sessions (abgelaufen oder widerrufen älter als 30 Tage).

### 3.3 E-Mail-Code (4a)

1. `POST /api/v1/auth/email-code` `{ email }`: setzt Cookie `__Host-login-nonce` (32 Byte zufällig, 15 min, `HttpOnly`, `Secure`, `SameSite=Lax`). Existiert ein User mit dieser E-Mail, entsteht ein Code (6 Ziffern, kryptografisch zufällig) mit Hash von Code und Nonce, gültig 10 min; frühere offene Codes dieser E-Mail werden ungültig; Mail in der Sprache des Users. Antwort immer `204` (keine Kontoaufzählung). Ist Mail abgeschaltet: `503` mit `auth.mailDisabled`.
2. `POST /api/v1/auth/email-code/verify` `{ email, code }`: nur mit passender Nonce, nicht abgelaufen, nicht benutzt, höchstens 5 Versuche (jeder Fehlversuch zählt hoch; danach `auth.tooManyAttempts`). Jeder Fehlschlag (kein Code, abgelaufen, benutzt, falsche Nonce, falscher Code) liefert dieselbe Antwort `400 auth.invalidCode`; die Grenzen (3 Anforderungen, 5 Versuche) gelten im Speicher je E-Mail und Browser auch für unbekannte Adressen, damit keine Konten aufgezählt werden können. Erfolg: Code als benutzt markiert, Nonce-Cookie gelöscht, Session angelegt, Antwort `me`.
3. Rate-Limits: Anfordern höchstens 3 je E-Mail und 10 je IP in 15 min; Prüfen höchstens 20 je IP in 15 min. Überschreitung `429` mit `auth.rateLimited` und `params.retryAfterSeconds`.

### 3.4 Sessions (4a)

- Token 32 Byte zufällig (base64url) im Cookie `__Host-session` (`HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, `Max-Age` = Restlaufzeit). DB speichert den SHA-256-Hash.
- Laufzeit gleitend 30 Tage, höchstens 180 Tage ab Anlage. Bei Nutzung wird `last_seen_at`/`expires_at` höchstens einmal pro Minute fortgeschrieben, das Cookie dabei erneuert.
- `POST /api/v1/auth/logout` widerruft die aktuelle Session und löscht das Cookie.
- Lokal (`http://localhost`) funktionieren `__Host-`-Cookies, weil localhost als sicherer Kontext gilt.

### 3.5 Passkeys (4b)

- `@simplewebauthn/server`; RP-ID = Hostname aus `APP_ORIGIN`, erwarteter Origin = `APP_ORIGIN`.
- Anlegen nur mit Session: `POST /api/v1/me/passkeys/options` → Browser → `POST /api/v1/me/passkeys` (`residentKey: required`, `userVerification: required`). Name aus dem Gerät vorbelegt, änderbar.
- Anmelden ohne E-Mail: `POST /api/v1/auth/passkey/options` → `POST /api/v1/auth/passkey/verify` (Discoverable Credentials, `userVerification: required`). Challenges serverseitig, an ein Nonce-Cookie gebunden, 5 min.
- Nach jedem Login per E-Mail-Code bietet die App an, einen Passkey anzulegen; nach jedem Login per Code geht eine Info-Mail „Neue Anmeldung“ (Gerät aus User-Agent, Zeit in der Zeitzone des Browsers bzw. UTC) an den User.
- Unsicherer Kontext (kein `window.isSecureContext` oder keine WebAuthn-API): Passkey-Knöpfe ausgeblendet, Hinweis mit Erklärung (Self-Hosting-Leitplanke 5).

### 3.6 Recovery (4b)

`recovery-link --email`: einmaliger Link `/wiederherstellen/:token` (256 Bit, Hash gespeichert, 1 h). Einlösen erzeugt eine Session mit `auth_method=recovery` und führt direkt zur Passkey-Einrichtung.

### 3.7 Haushalte, Rollen, Einladungen (4c)

- Rollen wie Architektur-Spec 7.1. Ein Haushalt hat immer mindestens einen `owner`; Verstöße (letzter owner geht, wird herabgestuft oder entfernt) → `409` `household.lastOwner`.
- API haushaltsbezogen unter `/api/v1/households/:householdId/...`; Guard prüft Mitgliedschaft und Mindestrolle; Repository-Methoden verlangen die `householdId`. Fremder oder unbekannter Haushalt → `404` (kein Hinweis auf Existenz).
- Jeder angemeldete User darf Haushalte anlegen (`POST /api/v1/households`, wird owner).
- Einladungen: owner lädt mit E-Mail und Rolle ein; Token 256 Bit, Hash, 7 Tage, einmalig; erneut senden erzeugt ein neues Token und macht das alte ungültig; widerrufbar. Annahme unter `/einladung/:token`:
  - ohne Konto: Name eingeben → User (E-Mail aus der Einladung, gilt als bestätigt) + Session (`auth_method=invitation`) + Mitgliedschaft; danach Passkey-Angebot (erst mit 4b);
  - mit Konto: nach Anmeldung annehmen; die E-Mail des angemeldeten Users muss passen, sonst `invitation.emailMismatch`;
  - ohne Mailversand zeigt die App dem owner den Link zum Kopieren.
- `PUT /api/v1/me` speichert `last_household_id` (aktueller Haushalt, geräteübergreifend).

### 3.8 Instanz-Einstellungen (4c)

- `GET /api/v1/instance/appearance` (öffentlich, auch für die Anmelden-Seite) liefert das gespeicherte Instanz-Theme oder `null`; `PUT` nur Plattform-Admin.
- Vorrang im Frontend: DB vor `config.json` (`SMART_INSTANCE_APPEARANCE`) vor Build-Standard.
- `features.instanceAppearanceEditor`, `SMART_INSTANCE_APPEARANCE_EDITOR` und das Speichern der Instanz im Browser entfallen.

### 3.9 Persönliche Einstellungen (4a)

`GET /api/v1/me` liefert `{ id, email, displayName, locale, appearance, isPlatformAdmin, households: [{ id, name, timezone, role }], currentHouseholdId }` (Haushalte ab 4c). `PUT /api/v1/me/preferences` `{ locale?, appearance? }` (validiert mit den Contracts-Schemas). Konflikte: letzte Änderung gewinnt.

### 3.10 Schutz und Fehler

- Ändernde Anfragen (`POST`, `PUT`, `PATCH`, `DELETE`) unter `/api` ohne `Origin` gleich `APP_ORIGIN` → `403` `auth.badOrigin`.
- Alle `/api`-Antworten `Cache-Control: no-store`.
- Fehlercodes als Enum in `@smart/contracts` (u. a. `auth.required`, `auth.invalidCode`, `auth.tooManyAttempts`, `auth.rateLimited`, `auth.mailDisabled`, `auth.badOrigin`, `auth.passkeyFailed`, `household.lastOwner`, `invitation.invalid`, `invitation.emailMismatch`, `validation.failed`); das Frontend übersetzt sie.
- Logs enthalten keine Codes, Tokens oder vollständigen E-Mail-Adressen (maskiert `t***@example.org`).

## 4. Frontend

### 4.1 Bundle-Platz (4a, zuerst)

Der `ThemeService` lädt `@smart/theme` per dynamischem Import und wendet das Theme danach an; das erste Bild übernehmen `theme-boot.js` und das Build-Standard-CSS. Ziel: initiales Bundle unter 440 kB. Danach `withInMemoryScrolling({ scrollPositionRestoration: 'enabled' })`.

### 4.2 Routen

- Außerhalb des Rahmens: `/anmelden`, `/einrichten` (4c), `/einladung/:token` (4c), `/wiederherstellen/:token` (4b).
- `Shell` als Layout-Route `{ path: '', component: Shell, canMatch: [angemeldet], children: [...] }`; bestehende Seiten werden Kinder.
- Guards: angemeldet (sonst `/anmelden?ziel=…`), Haushalt vorhanden (sonst `/einrichten`, 4c), Rolle/Plattform-Admin.
- Neu im Rahmen: „Mehr → Sicherheit“ (4b), „Mehr → Haushalt“ und „Mehr → Mitglieder“ (4c), „Mehr → Einstellungen → Erscheinungsbild der Installation“ nur für Plattform-Admin (4c).

### 4.3 Auth-Zustand und Offline-Start (4a)

- `core/auth`: `AuthService` mit Signal `me`; lädt `GET /api/v1/me` beim Start. Ein Abbild ohne Geheimnisse liegt in `localStorage` (`smart.me`).
- Offline-Start: zwischengespeichertes `me` + Offline-Banner; online wieder `me` laden.
- `401` auf irgendeiner Anfrage: Abbild löschen, nach `/anmelden?ziel=<aktuelle URL>`.
- Abmelden: Server-Logout, Abbild und Theme-Boot-Cache löschen, nach `/anmelden`.

### 4.4 Anmelden-Seite (4a, Passkey ab 4b)

Hauptknopf „Mit Passkey anmelden“ (4b); darunter „Code per E-Mail“: E-Mail → ein Eingabefeld für 6 Ziffern (`autocomplete="one-time-code"`, `inputmode="numeric"`) → angemeldet. Neuer Code anfordern nach 60 s. Alle Fehlercodes übersetzt. Ist Mail abgeschaltet, fehlt der Code-Weg mit Hinweis. Die Seite nutzt das Instanz-Theme und die Browsersprache.

### 4.5 Einstellungen am User (4a)

`ThemeService` und `LanguageService` übernehmen beim Start `me.appearance`/`me.locale`; Änderungen gehen (bei Theme entprellt, 500 ms) an `PUT /api/v1/me/preferences`. `localStorage` bleibt nur Boot-Cache (Theme) bzw. Startwert vor `me` (Sprache).

### 4.6 HTTP und Rückmeldung

Ein kleiner, auf `fetch` gestützter `ApiClient` (`core/api`: `get`, `post`, `put`; Token `API_FETCH` für die Browser-`fetch`, Präfix `API_BASE` = `/api/v1`): Er liest das Fehlerformat und wirft `ApiError`, meldet `401` über den Token `UNAUTHORIZED_HANDLER` und gibt Fehler als Snackbar aus (übersetzter Code). Angulars `HttpClient` entfällt; das spart rund 20 kB im initialen Bundle. Die Snackbar hält auf dem Handy Abstand zur unteren Leiste.

### 4.7 Haushalt in der Oberfläche (4c)

Titel der oberen Leiste = aktueller Haushalt; bei mehreren Haushalten ein Auswahlknopf. `UiFormatContext.timeZone` = Zeitzone des aktuellen Haushalts. „Mehr“-Einträge erhalten eine Mindestrolle bzw. „nur Plattform-Admin“; ohne Recht unsichtbar.

## 5. Konfiguration und Betrieb

| Variable         | Bedeutung                                                                              |
| ---------------- | -------------------------------------------------------------------------------------- |
| `APP_ORIGIN`     | z. B. `https://staging.smart.tillkosiol.de`; RP-ID, Origin-Prüfung, Links in Mails     |
| `SMTP_URL`       | z. B. `smtps://resend:<Schlüssel>@smtp.resend.com:465`; lokal Mailpit; leer = Mail aus |
| `MAIL_FROM`      | Absender (verifizierte Domain)                                                         |
| `MAIL_ALLOWLIST` | nur Staging: kommagetrennte Empfänger; leer = keine Einschränkung                      |

- `provision.sh` fragt den Resend-Schlüssel verdeckt ab (wie die B2-Schlüssel) und schreibt `SMTP_URL`, `MAIL_FROM`, für Staging `MAIL_ALLOWLIST`. Werte nie im Chat oder Repo.
- Mailpit läuft lokal (`infra/local`) und im Stack-Test.
- Backups decken die neuen Tabellen ohne Änderung ab.
- Self-Hosting: ohne `SMTP_URL` funktionieren Passkeys, CLI und Einladungen (Link kopieren); der E-Mail-Code ist abgeschaltet.

## 6. Tests

- Backend: Unit-Tests (Codes, Hashing, Laufzeitregeln, Maskierung); Integrationstests gegen echte DB (vorhandene Helfer). Pflicht-Sicherheitstests: falscher/fehlender `Origin`; Rate-Limits; keine Kontoaufzählung (gleiche Antwort, vergleichbare Zeit); Cookie-Flags; abgelaufene, widerrufene und über 180 Tage alte Sessions abgewiesen; Code nur mit passender Nonce, einmalig, maximal 5 Versuche; letzter owner; Mandanten-Guard (fremder Haushalt → 404); Einladung an andere E-Mail.
- Frontend: Specs für Guards, Interceptor, Auth-Zustand inkl. Offline-Start und 401; Storybook für Anmelden, Einrichten, Einladung, Sicherheitsseite, Mitglieder (beide Sprachen, beide Prüfthemes).
- Stack-E2E (Playwright): Anmelden per Code (Code aus der Mailpit-API), Abmelden, Passkey anlegen und damit anmelden (CDP `WebAuthn` virtueller Authenticator), Session auf anderem Kontext widerrufen, Einladung annehmen (mit und ohne Konto), Rollen wirken, Theme-Sync zwischen zwei Kontexten, Offline-Start mit letztem Stand.
- Bundle-Budget: initiales JavaScript unter 500 kB (Fehler), Ziel nach 4a unter 440 kB.

## 7. Anpassungen der Architektur-Spec

- 8.11: nur SMTP-Adapter; Resend per SMTP.
- 7.2: Rate-Limit-Werte wie 3.3; Recovery-Link 1 h gültig.
- 7.1/8.4: `instance_settings` (Instanz-Theme in der DB, Plattform-Admin); `users.last_household_id`; `users.theme` heißt `appearance`.
- Neu: Einrichtungsseite für den ersten Haushalt; Offline-Start mit letztem bekannten Stand.

## 8. Nicht-Ziele

Geräte, Räume, Gateways (Etappe 5/6); Benachrichtigungen und Push (Etappe 7); Konto löschen und Datenexport (später, eigener Plan); E-Mail-Adresse ändern (später); mehrere E-Mail-Adressen pro User; Social Login; Passwörter.
