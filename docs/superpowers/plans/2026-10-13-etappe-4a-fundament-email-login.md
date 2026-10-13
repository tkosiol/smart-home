# Etappe 4a: Fundament und E-Mail-Login – Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Man legt sich per CLI als Admin an, meldet sich per E-Mail-Code an und ab; Theme und Sprache liegen am User und gelten auf allen Geräten; die App startet offline mit dem letzten Stand – und das initiale Bundle hat wieder Luft.

**Architecture:** Backend: `platform/mail` (SMTP), `platform/http` (Fehlerformat, Origin-Prüfung, Cookies, Rate-Limits), `core/identity` (User, Sessions, E-Mail-Code, Einstellungen) mit Drizzle-Migrationen und einer CLI. Frontend: Farb-Engine lazy, `Shell` als Layout-Route, `core/api` (HTTP, Fehler), `core/auth` (Zustand, Guard, Offline-Abbild), Feature `auth` mit der Anmelden-Seite, Einstellungs-Sync.

**Tech Stack:** wie bisher; neu Backend `nodemailer` 7.x, `cookie-parser` 1.4.x, `@nestjs/throttler` 7.x, `@nestjs/schedule` 6.x (exakte Versionen beim Hinzufügen festlegen, Lizenzprüfung muss grün bleiben); Frontend `HttpClient`.

**Spec:** `docs/superpowers/specs/2026-10-13-etappe-4-identity-haushalte-design.md` (Abschnitte 2, 3.1–3.4, 3.9, 3.10, 4.1–4.6, 5, 6, 7) und Architektur-Spec Abschnitte 7.2, 7.3, 8.9, 8.11. Übertrag aus `docs/superpowers/plans/2026-10-12-etappe-3d-rahmen-seiten-pwa.md` („Übertrag in Etappe 4“).

**Planform:** schlank wie 3d – vollständiger Code nur an sicherheitsrelevanten und kniffligen Stellen (Token/Hash, Cookie, Origin, Fehlerformat, Code-Prüfung, Lazy-Theme, Layout-Route); sonst Verhalten, Schnittstellen und konkrete Tests.

## Global Constraints

- Alle Global Constraints aus Plan 3c/3d gelten weiter (Versionen, Komponentenregeln, Tokens, Texte nur mit Schlüssel, Storybook in zwei Durchläufen, keine KI-Attribution, Prüfung am Ende jeder Task: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`, bei Stories zusätzlich die Storybook-Prüfung, bei nginx/Container/E2E zusätzlich `sh infra/compose/test/stack-test.sh`).
- Backend-Architekturregeln (Lint): `platform/` nichts Fachliches; `core/*` nie `modules/*`; fremde Elemente nur über `index.ts`; Datenbankzugriff in Repositories.
- Geheimnisse (Session-Token, Code, Nonce) nur als SHA-256-Hash speichern; nie loggen; E-Mails in Logs maskiert (`t***@example.org`).
- Cookies: `__Host-session` und `__Host-login-nonce` mit `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, ohne `Domain`.
- Ändernde `/api`-Anfragen nur mit `Origin === APP_ORIGIN`; alle `/api`-Antworten `Cache-Control: no-store`.
- Fehlerformat `{ code, params, traceId }`, Codes aus `@smart/contracts` (`ApiErrorCode`).
- E-Mail-Code: 6 Ziffern, 10 min, einmalig, höchstens 5 Versuche, an die Nonce gebunden; Anfordern ≤ 3 je E-Mail und ≤ 10 je IP in 15 min; Prüfen ≤ 20 je IP in 15 min; Antwort aufs Anfordern immer `204`.
- Sessions: gleitend 30 Tage, absolut 180 Tage, Fortschreiben höchstens einmal pro Minute.
- Bundle: initiales JavaScript < 500 kB (Fehler); Ziel nach Task 1 < 440 kB.

## Review Focus

1. **Kontoaufzählung:** unbekannte vs. bekannte E-Mail beim Anfordern – gleiche Antwort, keine Mail, vergleichbare Laufzeit. → Test in Task 5.
2. **Code aus anderem Browser oder nach Ablauf/Missbrauch:** falsche Nonce, abgelaufen, schon benutzt, 6. Versuch, neuer Code macht alten ungültig. → Tests in Task 5.
3. **Session-Grenzen:** abgelaufen, widerrufen, älter als 180 Tage, Cookie manipuliert. → Tests in Task 4.
4. **Abgemeldet, offline, Server weg:** 401 mitten in der Nutzung, Start ohne Netz mit/ohne Abbild, Server antwortet 5xx. → Tests in Task 8.
5. **Erste Anmeldung auf neuem Gerät:** Theme und Sprache des Users erscheinen ohne Aufblitzen des falschen Themes länger als nötig; Änderungen landen auf dem Server. → Tests in Task 9 und E2E in Task 10.

---

### Task 1: Platz im Bundle

**Files:** `apps/frontend/projects/ui/src/lib/theme/theme.service.ts` (+ Spec), ggf. `theme-engine.ts` (neu), `apps/frontend/src/app/app.config.ts`, `apps/frontend/projects/ui/README.md`, `CLAUDE.md`.

**Verhalten:** `ThemeService` importiert `computeThemeVars`/`resolveAppearance` nicht mehr statisch aus `@smart/theme`, sondern lädt sie einmal per `import('@smart/theme')` (gekapselt in `loadThemeEngine(): Promise<ThemeEngine>`). Bis die Engine da ist, bleibt das Theme aus `theme-boot.js`/Default-CSS stehen; danach wendet der Service wie bisher an und schreibt den Boot-Cache. `resolved` (nur Auflösung von Modus/Kontrast, ohne Engine) bleibt synchron verfügbar – dafür `resolveAppearance` in eine engine-freie Datei verschieben, falls sie die Farb-Bibliothek zieht. Danach `withInMemoryScrolling({ scrollPositionRestoration: 'enabled' })` in `provideRouter` und die manuelle `scrollTo(0, 0)`-Logik in `PageTitleStrategy` entfernen (Fokus-Logik bleibt).

**Tests:** ThemeService-Specs auf `await` umstellen (`await TestBed.inject(ThemeService).ready` o. ä. – öffentliches `ready: Promise<void>` ergänzen); neuer Test: vor `ready` werden keine Variablen gesetzt, danach schon; Fehler beim Laden der Engine → Konsole-Warnung, App läuft mit Default-Theme. Bestehender E2E „boot script applies dark mode before the app runs“ und „config.json replaces the build default“ bleiben grün.

**Nachweis:** Build-Ausgabe: initial < 440 kB; im Bericht die Zahlen vorher/nachher. Commit `perf(ui): load the theme engine after the first paint`.

---

### Task 2: Contracts – Fehlercodes und Auth-Schemas

**Files:** `packages/contracts/src/api-error.ts`, `packages/contracts/src/auth.ts` (+ Specs), `index.ts`.

**Produces:**

```ts
export const API_ERROR_CODES = [
  'auth.required',
  'auth.badOrigin',
  'auth.invalidCode',
  'auth.codeExpired',
  'auth.tooManyAttempts',
  'auth.rateLimited',
  'auth.mailDisabled',
  'validation.failed',
  'internal',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];
export const apiErrorSchema = z.object({
  code: z.enum(API_ERROR_CODES),
  params: z.optional(z.record(z.string(), z.union([z.string(), z.number()]))),
  traceId: z.string(),
});
export const emailCodeRequestSchema = z.object({ email: z.email() });
export const emailCodeVerifySchema = z.object({
  email: z.email(),
  code: z.string().check(z.regex(/^\d{6}$/)),
});
export const meSchema = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
  locale: languageSchema,
  appearance: personalAppearanceSchema,
  isPlatformAdmin: z.boolean(),
});
export const preferencesUpdateSchema = z.object({
  locale: z.optional(languageSchema),
  appearance: z.optional(personalAppearanceSchema),
});
```

(`zod/mini`-Syntax wie im Paket üblich; E-Mails vor dem Prüfen `trim().toLowerCase()` normalisieren – `normalizeEmail(raw: string): string` exportieren.)

**Tests:** gültige/ungültige E-Mail, Code mit 5/7 Ziffern/Buchstaben, `normalizeEmail(' Till@Example.ORG ')` → `till@example.org`, Fehlerschema mit/ohne `params`. Commit `feat(contracts): add API error codes and auth schemas`.

---

### Task 3: Backend-Plattform – HTTP-Grundlagen und Mail

**Files:** `apps/backend/src/platform/config/env.schema.ts` (+ Spec), `apps/backend/src/platform/http/{index.ts,api-error.filter.ts,origin.guard.ts,no-store.middleware.ts,throttle.ts,*.spec.ts}`, `apps/backend/src/platform/mail/{index.ts,mail.module.ts,mail-sender.ts,smtp-mail-sender.ts,templates/*.ts,mask-email.ts,*.spec.ts}`, `app.module.ts`, `app.setup.ts`, `apps/backend/package.json`.

**Env (neu):** `APP_ORIGIN` (URL, Pflicht), `SMTP_URL` (optional, `smtp`/`smtps`), `MAIL_FROM` (Pflicht wenn `SMTP_URL`), `MAIL_ALLOWLIST` (optional, kommagetrennt, normalisiert). Lokal (`infra/local`, `.env.example`) `APP_ORIGIN=http://localhost:4200`, `SMTP_URL=smtp://127.0.0.1:1026`, `MAIL_FROM=Smart Home <noreply@localhost>`.

**Fehlerformat:** globaler Exception-Filter → `{ code, params, traceId }` (traceId aus pino-http `req.id`). `ApiError extends HttpException` mit `(status, code, params?)`; Zod-Validierungsfehler → `400 validation.failed` (ohne Feldwerte); unbekannte Fehler → `500 internal`, geloggt mit Stack.

**Origin-Prüfung (global, vor allen Controllern unter `/api`):**

```ts
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
/** CSRF defence (spec 3.10): SameSite=Lax cookies plus an exact Origin match on mutating requests. */
canActivate(context: ExecutionContext): boolean {
  const request = context.switchToHttp().getRequest<Request>();
  if (!MUTATING.has(request.method)) return true;
  if (request.headers.origin === this.env.APP_ORIGIN) return true;
  throw new ApiError(HttpStatus.FORBIDDEN, 'auth.badOrigin');
}
```

**no-store** für alle `/api`-Antworten; `cookie-parser` in `configureApp`; `@nestjs/throttler` mit In-Memory-Speicher und benannten Limits (`emailCodeRequestPerIp`, `emailCodeVerifyPerIp`) für Task 5; Überschreitung → `429 auth.rateLimited` mit `retryAfterSeconds`.

**Mail:** `MailSender` (`send(message: { to: string; subject: string; text: string; html: string }): Promise<void>`), `SmtpMailSender` (nodemailer `createTransport(SMTP_URL)`), `MAIL_SENDER`-Token; ohne `SMTP_URL` ein `DisabledMailSender` mit `enabled = false`. Allowlist: nicht enthaltene Empfänger werden verworfen und maskiert geloggt. Template `loginCode(locale, code)` → Betreff/Text/HTML auf `de`/`en` (Code groß, Gültigkeit 10 Minuten, Hinweis „Nicht angefordert? Ignorieren.“). `maskEmail('till@example.org')` → `t***@example.org`.

**Tests:** env (Pflichtfelder, `MAIL_FROM` ohne `SMTP_URL` erlaubt, mit `SMTP_URL` Pflicht); Filter (ApiError, Zod, unbekannt → Format und Status); Origin-Guard (GET ohne Origin ok; POST ohne/mit falschem Origin 403; mit richtigem ok); no-store-Header; Allowlist (verworfen + maskiert geloggt, erlaubte gesendet – Transport-Stub); Templates de/en enthalten den Code; maskEmail. Bestehende Health-E2E bleiben grün (Testumgebung um `APP_ORIGIN` ergänzen). Commit(s) `feat(backend): add the API error format, origin check and SMTP mail`.

---

### Task 4: Identity-Datenmodell und Sessions

**Files:** `apps/backend/src/core/identity/{index.ts,identity.module.ts,identity.schema.ts,users.repository.ts,sessions.repository.ts,session.service.ts,session.guard.ts,public.decorator.ts,current-user.decorator.ts,secrets.ts,cleanup.job.ts,*.spec.ts}`, Migration via `drizzle-kit generate` (`apps/backend/drizzle/0001_*.sql`), `test/identity-sessions.e2e-spec.ts`.

**Schema:** `users`, `sessions`, `email_login_codes` exakt wie Spec 3.2 (Spalten-Typen: `uuid` mit `defaultRandom()`, `timestamptz`, `jsonb` für `appearance` mit Default `{"mode":"system","contrast":"system"}`, `email` `text` unique; Index auf `sessions.token_hash` unique, `email_login_codes.email`).

**Geheimnisse:**

```ts
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
export const newToken = (): string => randomBytes(32).toString('base64url');
export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
export const newLoginCode = (): string => String(randomInt(0, 1_000_000)).padStart(6, '0');
export const sameHash = (a: string, b: string): boolean =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
```

**SessionService:** `create(userId, method, userAgent): Promise<{ token: string; expiresAt: Date }>`; `validate(token): Promise<{ userId: string; sessionId: string } | null>` (Hash suchen; `revoked_at` null; `expires_at` und `absolute_expires_at` in der Zukunft; `last_seen_at` älter als 60 s → `last_seen_at = now`, `expires_at = min(now + 30 d, absolute)`, Rückgabe `refreshed: true`); `revoke(sessionId)`. Cookie-Helfer `setSessionCookie(res, token, expiresAt)` / `clearSessionCookie(res)` mit den Flags aus den Global Constraints und `maxAge` bis `expiresAt`.

**SessionGuard (global):** Routen mit `@Public()` frei; sonst Cookie lesen, `validate`, bei Erfolg `request.user = { id, sessionId }` und bei `refreshed` Cookie erneuern; sonst `401 auth.required`. Health-Routen sind `@Public()`.

**Aufräumen:** `@nestjs/schedule` täglich 03:30 UTC: abgelaufene Codes, Sessions abgelaufen oder widerrufen älter als 30 Tage.

**Tests (Integration gegen DB, vorhandener `createFreshDatabase`-Helfer):** gültige Session; abgelaufen; widerrufen; älter als 180 Tage trotz Aktivität; manipuliertes Cookie; Fortschreiben nur nach > 60 s und nie über die absolute Grenze; Cookie-Flags (Set-Cookie-Header prüfen); geschützte Route ohne Cookie 401 im Fehlerformat; Aufräumjob entfernt nur Abgelaufenes. Commit(s) `feat(backend): add users and sessions`.

---

### Task 5: Anmelden per E-Mail-Code und Abmelden

**Files:** `apps/backend/src/core/identity/{email-login.service.ts,email-login.repository.ts,auth.controller.ts,*.spec.ts}`, `test/auth-email-code.e2e-spec.ts`.

**Endpunkte:** `POST /api/v1/auth/email-code` (`@Public`), `POST /api/v1/auth/email-code/verify` (`@Public`), `POST /api/v1/auth/logout`.

**Anfordern:**

```ts
async request(email: string, nonce: string): Promise<void> {
  if (!this.mail.enabled) throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'auth.mailDisabled');
  const user = await this.users.findByEmail(email);
  // Same response and comparable work for unknown addresses: no account enumeration (spec 3.3).
  const code = newLoginCode();
  if (!user) {
    sha256(code);
    return;
  }
  await this.codes.replaceOpen(email, {
    codeHash: sha256(code),
    browserNonceHash: sha256(nonce),
    expiresAt: addMinutes(new Date(), 10),
  });
  // Not awaited: SMTP latency would otherwise reveal that the account exists. Failures are logged.
  void this.mail.send({ to: email, ...loginCode(user.locale, code) }).catch((error) =>
    this.logger.error({ to: maskEmail(email), err: error }, 'login code mail failed'),
  );
}
```

Controller: Nonce aus Cookie `__Host-login-nonce` übernehmen oder neu erzeugen und setzen (15 min); Limit je E-Mail (3/15 min, Zähler aus `email_login_codes` der letzten 15 min) und je IP (Throttler 10/15 min); immer `204`.

**Prüfen:** offenen Code der E-Mail laden (neuester, `used_at` null). Kein Code, falsche Nonce oder abgelaufen → `400 auth.codeExpired` bzw. `auth.invalidCode` (falsche Nonce wie ungültig behandeln); `attempts >= 5` → `429 auth.tooManyAttempts`; falscher Code → `attempts + 1`, `400 auth.invalidCode` (`params.attemptsLeft`); richtig → `used_at`, Nonce-Cookie löschen, Session (`email_code`), Session-Cookie, Antwort `me`. Vergleich mit `sameHash`. Throttler 20/15 min je IP.

**Abmelden:** aktuelle Session widerrufen, Cookie löschen, `204`.

**Tests (E2E mit In-Memory-`MailSender`, Override des Tokens):** bekannte E-Mail → genau eine Mail mit Code; unbekannte → `204`, keine Mail, Laufzeit beider Anfragen im selben Rahmen (keine DB-Schreibzugriffe für unbekannt); Großschreibung/Leerzeichen in der E-Mail egal; richtiger Code → Session-Cookie + `me`; falsche Nonce (anderer Agent) → abgelehnt; abgelaufen (Zeit per Clock-Injection oder DB-Update) → `auth.codeExpired`; schon benutzt → abgelehnt; 5 Fehlversuche, dann auch der richtige Code → `auth.tooManyAttempts`; zweiter angeforderter Code macht den ersten ungültig; 4. Anforderung derselben E-Mail in 15 min → `429`; Mail aus → `503 auth.mailDisabled`; Abmelden widerruft (danach 401). Commit(s) `feat(backend): sign in with an emailed code`.

---

### Task 6: `/me`, Einstellungen und CLI

**Files:** `apps/backend/src/core/identity/{me.controller.ts,cli/*.ts}`, `apps/backend/src/cli.ts`, `apps/backend/package.json` (Script), `infra/deploy/admin.sh` (+ Test in `infra/deploy/test/run-tests.sh`), `docs/runbooks/provisioning.md`.

**Endpunkte:** `GET /api/v1/me` → `meSchema`; `PUT /api/v1/me/preferences` (`preferencesUpdateSchema`) → aktualisiertes `me`.

**CLI:** `node dist/cli.js create-admin --email <e> --name <n>`: normalisiert die E-Mail, legt den User mit `is_platform_admin = true` und `locale = de` an; existiert er schon, setzt es nur `is_platform_admin` (idempotent); Ausgabe ohne Geheimnisse; Exit 1 mit Meldung bei ungültiger E-Mail. Nutzt `NestFactory.createApplicationContext(AppModule)` ohne HTTP.

**`infra/deploy/admin.sh`** (lokal von Till ausgeführt, wie `provision.sh`): `SMART_VPS=<user@host> infra/deploy/admin.sh <staging|production> create-admin --email … --name …` → per `ssh -t` im Stack-Verzeichnis `docker compose … exec -T api node dist/cli.js …`. Argumente werden einzeln gequotet weitergereicht (keine Shell-Injection); nur `create-admin` erlaubt (4b ergänzt `recovery-link`).

**Tests:** `/me` ohne Session 401, mit Session korrekt; Preferences: gültig speichert, ungültiger Modus → `400 validation.failed`, ohne Origin → 403; CLI: neu, idempotent, ungültige E-Mail (Integrationstest gegen DB); `admin.sh`: refuses unknown commands, quotes arguments (Stub-ssh wie bei den Deploy-Tests). Commit(s) `feat(backend): add me, preferences and the create-admin command`.

---

### Task 7: Frontend – HTTP, Fehler und Layout-Route

**Files:** `apps/frontend/src/app/core/api/{index.ts,api-error.ts,error.interceptor.ts,*.spec.ts}`, `app.config.ts`, `app.routes.ts`, `app.ts`, `shell/shell.ts`, `projects/ui/src/lib/snackbar/*` (Abstand zur Leiste), `src/i18n/{de,en}.json`.

**Verhalten:**

- `provideHttpClient(withFetch(), withInterceptors([errorInterceptor]))`.
- `errorInterceptor`: nur `/api/`-Anfragen; liest `apiErrorSchema` (Fallback `internal`); `401 auth.required` → `inject(UNAUTHORIZED_HANDLER)()` (Token in `core/api`, Standard: nichts tun; Task 8 belegt es mit `AuthService.handleUnauthorized`); andere Fehler → `ApiError`-Objekt (`code`, `params`, `status`) weiterwerfen. Anzeige: Komponenten zeigen Fehler selbst; ein Helfer `showApiError(error)` übersetzt `app.errors.<code>` und zeigt eine Snackbar.
- Layout-Route:

```ts
export const routes: Routes = [
  {
    path: 'anmelden',
    title: marker('app.title.signIn'),
    loadChildren: () => import('./features/auth').then((m) => m.authRoutes),
  },
  {
    path: '',
    component: Shell,
    canMatch: [signedIn],
    children: [/* bisherige Routen inkl. ** Nicht gefunden */],
  },
  { path: '**', redirectTo: 'anmelden' },
];
```

In dieser Task ohne `canMatch`; Task 8 ergänzt `canMatch: [signedIn]`. `App` rendert nur noch `<router-outlet />`.

- Snackbar: auf Compact-Breite Abstand `--smart-size-nav-bar` nach unten (über `MatSnackBarConfig.panelClass` + globale Regel in `projects/ui/src/styles.scss`, nur solange `ui-adaptive-shell[data-window-class='compact']` existiert).

**Tests:** Interceptor (Fehlerformat gelesen; kaputte Antwort → `internal`; 401 ruft den Handler – in dieser Task ein injizierbares Token `UNAUTHORIZED_HANDLER`, das Task 8 mit dem AuthService belegt); Routen: unbekannte Route im angemeldeten Zustand → „Nicht gefunden“ im Rahmen; Snackbar-Story compact mit Abstand. Commit(s) `feat(frontend): add the API client and the shell as layout route`.

---

### Task 8: Frontend – Auth-Zustand, Anmelden-Seite, Abmelden, Offline-Start

**Files:** `apps/frontend/src/app/core/auth/{index.ts,auth.service.ts,me-cache.ts,signed-in.guard.ts,*.spec.ts}`, `apps/frontend/src/app/features/auth/**` (Seite `/anmelden`, Scope-Übersetzungen), `features/more` (Eintrag „Abmelden“), `transloco.config.cjs` (`scopePathMap.auth`), Stories in `projects/ui` falls neue UI-Bausteine nötig (z. B. Code-Eingabe über `ui-text-field` mit `inputmode`/`autocomplete` – fehlende Inputs dort ergänzen).

**AuthService:**

- `me: Signal<Me | null>`, `status: Signal<'unknown' | 'signedIn' | 'signedOut' | 'offline'>`.
- `load()`: `GET /api/v1/me`; Erfolg → `me` setzen, Abbild `smart.me` (nur `meSchema`-Felder) speichern; `401` → abgemeldet, Abbild löschen; Netzwerkfehler → Abbild vorhanden: `offline` mit Abbild, sonst `signedOut`-Seite mit Hinweis „Keine Verbindung“.
- `handleUnauthorized()`: Abbild löschen, `me = null`, Navigation nach `/anmelden?ziel=<aktuelle URL>`.
- `requestCode(email)`, `verifyCode(email, code)`, `logout()` (Server, Abbild + `smart.theme.boot` löschen, nach `/anmelden`).
- Beim Wechsel von `offline` zu online (`OnlineStatus`) `load()` erneut.

**Guard `signedIn`:** wartet auf den ersten `load()`; `signedIn` oder `offline` → true; sonst UrlTree `/anmelden?ziel=…`.

**Anmelden-Seite** (außerhalb des Rahmens, `ui-page`): Schritt 1 E-Mail (`ui-text-field type="email" autocomplete="email"`), „Code senden“; Schritt 2 Code (ein Feld, `inputmode="numeric"`, `autocomplete="one-time-code"`, 6 Ziffern), „Anmelden“, „Neuen Code senden“ nach 60 s, „Andere E-Mail“. Fehler übersetzt am Feld (`auth.invalidCode` mit verbleibenden Versuchen, `auth.codeExpired`, `auth.tooManyAttempts`, `auth.rateLimited` mit Sekunden). `auth.mailDisabled` → Hinweis statt Formular. Nach Erfolg zu `ziel` (nur relative App-Pfade erlaubt, sonst `/`).

**Tests:** AuthService (Erfolg speichert Abbild; 401 löscht; offline mit/ohne Abbild; logout räumt auf; `ziel`-Prüfung gegen offene Weiterleitung `//evil.example`, `https://…`); Guard; Seite (beide Schritte, Fehlertexte de/en, Timer für „Neuen Code senden“ mit Fake-Timern); Story der Seite in beiden Sprachen und Themes. Commit(s) `feat(frontend): sign in with an emailed code`.

---

### Task 9: Einstellungen am User

**Files:** `apps/frontend/src/app/core/auth/preferences-sync.ts` (+ Spec), Anpassungen in `projects/ui/src/lib/theme/theme.service.ts` (Hook für Änderungen), `core/i18n/language.service.ts`.

**Verhalten:** Nach `load()` setzt der Sync `ThemeService.setPersonal(me.appearance)` und `LanguageService.setLanguage(me.locale)` ohne Rückschreiben. Spätere Änderungen durch den Nutzer (Theme-Editor, Sprachwahl) gehen entprellt (500 ms) per `PUT /api/v1/me/preferences`; Antwort aktualisiert `me` und das Abbild. Offline: Änderung lokal wirksam, wird beim nächsten Online-`load()` nicht überschrieben, sondern zuerst gesendet (letzte lokale Änderung gewinnt, wenn sie nach dem letzten Server-Stand liegt – Zeitstempel im Abbild). Abgemeldet: nichts senden.

**Tests:** Server-Stand wird übernommen ohne PUT; Änderung → genau ein PUT nach 500 ms trotz mehrerer schneller Änderungen; Fehler beim PUT → Snackbar, lokaler Stand bleibt; offline geändert → beim Online-Wechsel PUT vor `me`-Übernahme; Sprache vom Server setzt `<html lang>`. Commit `feat(frontend): keep theme and language on the account`.

---

### Task 10: Betrieb, Stack-Test, Doku

**Files:** `infra/compose/compose.yaml` (api: `APP_ORIGIN`, `SMTP_URL`, `MAIL_FROM`, `MAIL_ALLOWLIST`), `infra/compose/.env.example`, `infra/compose/test/compose.test.yaml` (+ Mailpit-Dienst, `APP_ORIGIN=http://127.0.0.1:18080`, `SMTP_URL=smtp://mailpit:1025`), `infra/compose/test/stack-test.sh` (Admin per CLI anlegen), `infra/deploy/provision.sh` (+ Tests: Resend-Schlüssel verdeckt abfragen, `SMTP_URL`, `MAIL_FROM`, Staging `MAIL_ALLOWLIST` abfragen; `--force` behält vorhandene Werte), `tests/e2e/specs/auth.spec.ts`, `apps/frontend/nginx/default.conf` (falls nötig: `/api` Cookies unverändert durchreichen), Doku: Architektur-Spec 7.2/8.4/8.11 laut Spec-Abschnitt 7, `docs/runbooks/provisioning.md` (Mail, Admin anlegen), `CLAUDE.md`, `apps/frontend/projects/ui/README.md` falls UI-Änderungen.

**E2E (Playwright, Mailpit-API `GET /api/v1/messages` / `GET /api/v1/message/:id`):**

1. Nicht angemeldet: `/` → `/anmelden`.
2. Code anfordern für den CLI-Admin, Code aus Mailpit lesen, eingeben → Übersicht; `__Host-session` gesetzt (HttpOnly, Secure-Flag im Stack über `http://127.0.0.1`? – der Stack-Test läuft ohne TLS; `Secure`-Cookies werden von Chromium für `127.0.0.1` akzeptiert, sonst `localhost` als Base-URL verwenden und im Bericht vermerken).
3. Abmelden über „Mehr“ → `/anmelden`, `/` wieder geschützt.
4. Theme „Dunkel“ in Kontext A wählen → neuer Kontext B, anmelden → dunkel.
5. Offline-Start: angemeldet, Service Worker aktiv, offline neu laden → Übersicht mit Offline-Banner.
6. Unbekannte E-Mail → gleiche Bestätigung, keine Mail in Mailpit.

**Nach dem Merge (Till):** `provision.sh staging --force` (Resend-Schlüssel, Freigabeliste) und `production --force`; `admin.sh staging create-admin …`. Commit(s) `feat(infra): configure mail and origin, cover sign-in in the stack` und `docs: …`.
