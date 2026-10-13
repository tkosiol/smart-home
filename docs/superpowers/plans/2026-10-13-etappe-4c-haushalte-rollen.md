# Etappe 4c: Haushalte und Rollen – Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wer sich anmeldet, legt seinen ersten Haushalt an, lädt die Familie mit Rollen ein und wechselt zwischen Haushalten; Rollen wirken in API und Oberfläche, Zeiten erscheinen in der Zeitzone des Haushalts, und das Instanz-Theme pflegt der Plattform-Admin in der App statt per Schalter.

**Architecture:** Backend: neues Core-Modul `core/households` (Haushalte, Mitgliedschaften, Einladungen, Instanz-Einstellungen) auf `core/identity`; Mandanten-Guard mit Mindestrolle; `/me` bekommt Haushalte über einen Token, den `core/households` bereitstellt (keine Rückabhängigkeit). Frontend: `core/household` (aktueller Haushalt, Guards, Zeitzone), `MoreEntry` mit Mindestrolle, Feature `households` (Einrichten, Wechseln, Haushalt, Mitglieder), Feature `invitation` (Einladung annehmen), Instanz-Theme aus der API.

**Tech Stack:** wie 4a; keine neuen Abhängigkeiten.

**Spec:** `docs/superpowers/specs/2026-10-13-etappe-4-identity-haushalte-design.md` (Abschnitte 2, 3.1, 3.2, 3.7, 3.8, 3.9, 3.10, 4.2, 4.7, 6) und Architektur-Spec 7.1. Übertrag aus `docs/superpowers/plans/2026-10-13-etappe-4a-fundament-email-login.md` („Ergebnis und Übertrag“). Baut auf dem Branch `feat/etappe-4a-fundament-email-login` auf.

**Planform:** schlank wie 4a – vollständiger Code nur an sicherheitsrelevanten und kniffligen Stellen (Mandanten-Guard, letzter owner, Einladung annehmen, `/me`-Erweiterung, Instanz-Theme); sonst Verhalten, Schnittstellen und konkrete Tests.

**Bewusste Entscheidungen:**

- **Haushaltswechsler als Seite:** `@smart/ui` hat noch kein Menü und keinen Dialog. Bei mehreren Haushalten zeigt die obere Leiste einen Knopf „Haushalt wechseln“, der die Seite `/haushalte` öffnet (Liste, Auswahl, „Neuen Haushalt anlegen“). Ein Menü folgt, sobald es eine Komponente dafür gibt.
- **Bestätigen ohne Dialog:** Entfernen, Verlassen und Widerrufen sind zweistufige Knöpfe (erster Druck: „Wirklich entfernen?“, zweiter Druck führt aus, nach 5 s zurück).
- **Einladungslink immer sichtbar:** Anlegen und erneut senden liefern dem owner den Link einmalig zum Kopieren, auch mit Mailversand. Auf Staging verwirft die Freigabeliste Mails an Familienmitglieder; ohne Link käme die Einladung dort nie an. Gespeichert wird weiterhin nur der Hash.
- **Keine Storybook-Stories für App-Seiten** (wie 4a, Task 8): Storybook deckt `@smart/ui`; die Seiten prüfen Specs und E2E.
- **Altes Geräteabbild:** Ein `smart.me` ohne `households` besteht die Prüfung nicht mehr und gilt als „kein Abbild“ (einmalig nach dem Update kein Offline-Start).

## Global Constraints

- Alle Global Constraints aus Plan 4a gelten weiter (Prüfung am Ende jeder Task: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`; bei nginx/Container/E2E zusätzlich `sh infra/compose/test/stack-test.sh`; keine KI-Attribution; öffentliche Repo-Regeln; Geheimnisse nur als SHA-256-Hash; Fehlerformat `{ code, params, traceId }`; Logs ohne Tokens und mit maskierten E-Mails; unbekannte Fehler nur über `describeError`).
- Rollen: `viewer` < `member` < `owner` (Architektur-Spec 7.1). Ein Haushalt hat immer mindestens einen `owner`; Verstoß → `409 household.lastOwner`.
- Haushaltspfade: `/api/v1/households/:householdId/...`; fremder, unbekannter oder ungültiger Haushalt → `404 household.notFound` (kein Hinweis auf Existenz); Mitglied mit zu kleiner Rolle → `403 household.forbidden`. Repository-Methoden für haushaltsbezogene Daten verlangen die `householdId`.
- Einladungen: Token 256 Bit (`newToken()`), nur Hash gespeichert, 7 Tage gültig, einmalig; erneut senden ersetzt das Token; widerrufbar.
- Namen (Haushalt, Anzeigename): getrimmt, 1–60 Zeichen, keine Steuerzeichen. Zeitzone: gültige IANA-Zone.
- Instanz-Theme: `GET /api/v1/instance/appearance` öffentlich; `PUT` nur Plattform-Admin (`403 auth.forbidden`). Vorrang im Frontend: DB vor `config.json` vor Build-Standard. `features.instanceAppearanceEditor`, `SMART_INSTANCE_APPEARANCE_EDITOR` und `STORED_INSTANCE_ALLOWED` entfallen.
- Bundle: initiales JavaScript < 500 kB (Fehler); neue Seiten lazy; `core/household` bleibt klein.

## Review Focus

1. **Fremde IDs unter eigenem Haushalt:** Mitglieds- oder Einladungs-ID eines anderen Haushalts in einem Pfad des eigenen Haushalts → `404`, nichts geändert. → Tabellentest aller Haushaltspfade in Task 4.
2. **Letzter owner bei gleichzeitigen Änderungen:** zwei owner stufen sich gleichzeitig gegenseitig herab oder verlassen gleichzeitig den Haushalt → mindestens ein owner bleibt. → Parallel-Test in Task 3.
3. **Einladung in allen Zuständen:** abgelaufen, widerrufen, schon angenommen, durch erneutes Senden ersetzt, falsche E-Mail, schon Mitglied, „ohne Konto“ für eine E-Mail mit Konto → jeweils definierte Antwort, keine zweite Mitgliedschaft, kein zweiter User. → Tests in Task 4.
4. **Rechte fallen während der Nutzung weg:** User wird entfernt oder herabgestuft, während die App offen ist → nächste Anfrage `404`/`403` → App lädt `me` neu und wechselt in einen verbliebenen Haushalt bzw. nach `/einrichten`, statt in Fehlern hängen zu bleiben. → Tests in Task 7.
5. **Zeitzone wechselt:** Zeitzone des Haushalts geändert oder Haushalt gewechselt → Zeitangaben sofort in der neuen Zone; Offline-Start nutzt die Zone aus dem Abbild. → Tests in Task 7 und 8.

---

### Task 1: Contracts – Haushalte, Einladungen, Fehlercodes

**Files:** `packages/contracts/src/households.ts` (+ `.spec.ts`), `packages/contracts/src/auth.ts` (`meSchema`), `packages/contracts/src/api-error.ts`, `packages/contracts/src/index.ts`.

**Interfaces (Produces):**

```ts
export const HOUSEHOLD_ROLES = ['viewer', 'member', 'owner'] as const;
export type HouseholdRole = (typeof HOUSEHOLD_ROLES)[number];
export const householdRoleSchema = z.enum(HOUSEHOLD_ROLES);
/** True when `role` grants at least `minimum`. */
export function hasRole(role: HouseholdRole, minimum: HouseholdRole): boolean;

export const displayNameSchema; // trim, 1–60, keine Steuerzeichen (/[\u0000-\u001f\u007f]/)
export const timeZoneSchema;    // string, gültig wenn new Intl.DateTimeFormat('en', { timeZone }) nicht wirft
export const householdSummarySchema = z.object({ id, name, timezone, role: householdRoleSchema });
export const householdCreateSchema = z.object({ name: displayNameSchema, timezone: timeZoneSchema });
export const householdUpdateSchema = z.object({ name?: displayNameSchema, timezone?: timeZoneSchema });
export const currentHouseholdUpdateSchema = z.object({ householdId: z.string() });
export const memberSchema = z.object({ userId, displayName, email, role, joinedAt: z.string() /* ISO …Z */ });
export const memberRoleUpdateSchema = z.object({ role: householdRoleSchema });
export const invitationCreateSchema = z.object({ email: emailSchema, role: householdRoleSchema });
export const invitationSchema = z.object({ id, email, role, invitedByName, createdAt, expiresAt });
export const invitationCreatedSchema = z.object({ invitation: invitationSchema, link: z.string() });
export const invitationPreviewSchema = z.object({ householdName, role, email, invitedByName, accountExists: z.boolean() });
export const invitationAcceptNewSchema = z.object({ displayName: displayNameSchema, locale: languageSchema });
export const instanceAppearanceUpdateSchema = z.object({ appearance: z.nullable(instanceAppearanceSchema) });
```

`meSchema` erhält `households: z.array(householdSummarySchema)` und `currentHouseholdId: z.nullable(z.string())` (Pflichtfelder). Neue Fehlercodes in `API_ERROR_CODES`: `auth.forbidden`, `household.notFound`, `household.forbidden`, `household.lastOwner`, `invitation.invalid`, `invitation.emailMismatch`, `invitation.accountExists`, `invitation.alreadyMember`.

**Tests:** `hasRole` für alle 9 Paare; `displayNameSchema` trimmt, lehnt leer, 61 Zeichen und Zeilenumbruch ab; `timeZoneSchema` akzeptiert `Europe/Berlin`, `Pacific/Chatham`, lehnt `Mars/Olympus` und `''` ab; `meSchema` lehnt ein Objekt ohne `households` ab; Fehlercodes enthalten die neuen Werte. Nach Änderung `pnpm packages:build`. Commit `feat(contracts): describe households, members and invitations`.

---

### Task 2: Haushalte, Mitgliedschaft und Mandanten-Guard

**Files:** `apps/backend/src/core/households/{index.ts,households.module.ts,households.schema.ts,households.repository.ts,memberships.repository.ts,household.guard.ts,require-role.decorator.ts,households.controller.ts,me-households.ts,*.spec.ts}`, `apps/backend/src/core/identity/{me.ts,me.service.ts,me.controller.ts,auth.controller.ts,index.ts}`, `apps/backend/src/app.module.ts`, Migration `apps/backend/drizzle/0002_*.sql` (per `drizzle-kit generate`), `apps/backend/test/households.e2e-spec.ts`.

**Schema (Spec 3.2):** `households` (`id` uuid `defaultRandom()`, `name` text, `timezone` text, `created_at` timestamptz), `memberships` (`household_id` → households `on delete cascade`, `user_id` → users `on delete cascade`, `role` text mit CHECK auf die drei Rollen, `created_at`; PK (`household_id`, `user_id`); Index auf `user_id`), `users.last_household_id` (uuid, nullable, → households `on delete set null`).

**`/me` mit Haushalten ohne Rückabhängigkeit:** `core/identity` definiert den Port, `core/households` liefert ihn.

```ts
// core/identity/me.service.ts
export interface MeHouseholds {
  forUser(
    userId: string,
    lastHouseholdId: string | null,
  ): Promise<Pick<Me, 'households' | 'currentHouseholdId'>>;
}
export const ME_HOUSEHOLDS = Symbol('ME_HOUSEHOLDS');

@Injectable()
export class MeService {
  constructor(@Optional() @Inject(ME_HOUSEHOLDS) private readonly households?: MeHouseholds) {}
  async forUser(user: User): Promise<Me> {
    const extra = (await this.households?.forUser(user.id, user.lastHouseholdId)) ?? {
      households: [],
      currentHouseholdId: null,
    };
    return { ...toMe(user), ...extra };
  }
}
```

`HouseholdsModule` ist `@Global()` und stellt `{ provide: ME_HOUSEHOLDS, useExisting: MeHouseholdsSource }` bereit und exportiert es. `MeController` und `AuthController` (Antwort auf `verify`) nutzen `MeService` statt `toMe`. `MeHouseholdsSource.forUser`: Haushalte des Users nach Name sortiert; `currentHouseholdId` = `lastHouseholdId`, wenn der User dort noch Mitglied ist, sonst die älteste Mitgliedschaft, sonst `null`.

**Mandanten-Guard:**

```ts
export const REQUIRED_ROLE = 'households:requiredRole';
export const RequireRole = (role: HouseholdRole) => SetMetadata(REQUIRED_ROLE, role);

@Injectable()
export class HouseholdGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly memberships: MembershipsRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<HouseholdRole | undefined>(REQUIRED_ROLE, [
      context.getHandler(),
      context.getClass(),
    ]);
    // Fail closed: a household route without a declared role is a programming error.
    if (!required) throw new Error('household route without @RequireRole');
    const request = context.switchToHttp().getRequest<HouseholdRequest>();
    const householdId = request.params['householdId'] ?? '';
    // Unknown, malformed and foreign households answer alike: no hint that a household exists.
    const membership = isUuid(householdId)
      ? await this.memberships.find(householdId, request.user.id)
      : undefined;
    if (!membership) throw new ApiError(HttpStatus.NOT_FOUND, 'household.notFound');
    if (!hasRole(membership.role, required)) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'household.forbidden');
    }
    request.membership = membership;
    return true;
  }
}
```

Jeder Controller unter `v1/households/:householdId` trägt `@UseGuards(HouseholdGuard)` auf Klassenebene und an jeder Methode `@RequireRole(...)`; `HouseholdRequest` = `AuthenticatedRequest & { membership: Membership }`.

**Endpunkte:** `POST /api/v1/households` (`householdCreateSchema`; legt Haushalt und owner-Mitgliedschaft in einer Transaktion an, setzt `last_household_id`; Antwort `me`). `PATCH /api/v1/households/:householdId` (owner; `householdUpdateSchema`; Antwort `householdSummarySchema`). `PUT /api/v1/me` (`currentHouseholdUpdateSchema`; nur als Mitglied, sonst `404 household.notFound`; setzt `last_household_id`; Antwort `me`) – im `households`-Modul, weil es die Mitgliedschaft prüft.

**Tests (Integration gegen DB):** `GET /me` ohne Haushalt → `households: []`, `currentHouseholdId: null`; nach `POST /households` → owner, `currentHouseholdId` gesetzt; ungültiger Name/Zeitzone → `400 validation.failed`; `PATCH` als owner ändert, als member → `403 household.forbidden`, als Nicht-Mitglied → `404`, mit `not-a-uuid` → `404`, mit zufälliger UUID → `404` (alle drei Antworten byte-gleich bis auf `traceId`); `PUT /me` auf fremden Haushalt → `404`, auf eigenen → `currentHouseholdId`; `last_household_id` auf einen Haushalt, den der User verlassen hat → fällt auf die älteste Mitgliedschaft zurück; Verify-Antwort enthält `households`; Unit-Test: Guard wirft ohne `@RequireRole`. Commit(s) `feat(backend): add households and the household guard`.

---

### Task 3: Mitglieder und Rollen

**Files:** `apps/backend/src/core/households/{members.controller.ts,members.service.ts,memberships.repository.ts,*.spec.ts}`, `apps/backend/test/household-members.e2e-spec.ts`.

**Endpunkte:** `GET /api/v1/households/:householdId/members` (viewer; `memberSchema[]`, nach Name). `PATCH .../members/:userId` (owner; `memberRoleUpdateSchema`). `DELETE .../members/:userId` (owner – oder jede Rolle, wenn `userId` der eigene ist = Haushalt verlassen; `204`). Unbekannte oder fremde `userId` → `404 household.notFound`.

**Letzter owner – serialisiert pro Haushalt:**

```ts
/** Changes or removes one membership; a household always keeps at least one owner (spec 3.7). */
async change(householdId: string, userId: string, next: HouseholdRole | 'removed'): Promise<void> {
  await this.db.transaction(async (tx) => {
    // Lock every membership of the household: two owners demoting each other at the same time
    // must not leave the household without an owner.
    const rows = await tx
      .select()
      .from(memberships)
      .where(eq(memberships.householdId, householdId))
      .for('update');
    const target = rows.find((row) => row.userId === userId);
    if (!target) throw new ApiError(HttpStatus.NOT_FOUND, 'household.notFound');
    const ownersAfter = rows.filter((row) =>
      row.userId === userId ? next === 'owner' : row.role === 'owner',
    ).length;
    if (ownersAfter === 0) throw new ApiError(HttpStatus.CONFLICT, 'household.lastOwner');
    if (next === 'removed') {
      await tx.delete(memberships).where(and(eq(memberships.householdId, householdId), eq(memberships.userId, userId)));
    } else {
      await tx.update(memberships).set({ role: next }).where(and(eq(memberships.householdId, householdId), eq(memberships.userId, userId)));
    }
  });
}
```

**Tests:** Liste als viewer; Rolle ändern als owner, als member → `403`; letzter owner stuft sich herab → `409 household.lastOwner`, verlässt → `409`, wird entfernt → `409`; zwei owner: einer verlässt → ok; **parallel:** zwei owner stufen sich per `Promise.all` gegenseitig herab → genau eine Anfrage `409`, danach genau ein owner; member verlässt selbst → `204`, danach `GET /me` ohne den Haushalt; member entfernt anderen → `403`; `userId` aus einem anderen Haushalt im eigenen Pfad → `404`, nichts geändert. Commit(s) `feat(backend): manage members and roles`.

---

### Task 4: Einladungen

**Files:** `apps/backend/src/core/households/{invitations.schema.ts (oder in households.schema.ts),invitations.repository.ts,invitations.service.ts,invitations.controller.ts,invitation-accept.controller.ts,*.spec.ts}`, `apps/backend/src/platform/mail/templates/invitation.ts` (+ Export, de/en), `apps/backend/src/core/households/cleanup` (täglich: Einladungen löschen, die seit mehr als 30 Tagen abgelaufen, widerrufen oder angenommen sind), Migration `0003_*.sql`, `apps/backend/test/household-invitations.e2e-spec.ts`, `apps/backend/test/household-tenancy.e2e-spec.ts`.

**Schema (Spec 3.2):** `invitations` (`id`, `household_id` → households `on delete cascade`, `email` (normalisiert), `role`, `token_hash` unique, `invited_by` → users, `created_at`, `expires_at`, `accepted_at`, `revoked_at`); Index auf (`household_id`, `email`).

**Owner-Endpunkte** (`v1/households/:householdId/invitations`, owner): `GET` offene Einladungen (nicht angenommen, nicht widerrufen, nicht abgelaufen). `POST` (`invitationCreateSchema`): E-Mail schon Mitglied → `409 invitation.alreadyMember`; offene Einladung derselben E-Mail wird widerrufen und ersetzt; Token `newToken()`, Hash, 7 Tage; Mail (Sprache des Einladenden, Link `${APP_ORIGIN}/einladung/${token}`, Haushaltsname, Name des Einladenden), Versand nicht abwarten, Fehler maskiert loggen; ohne Mail kein Fehler; Antwort `invitationCreatedSchema` (`201`). `POST .../:invitationId/resend`: neues Token, neue 7 Tage, Mail, Antwort wie `POST`. `DELETE .../:invitationId`: `revoked_at`, `204`. Fremde oder unbekannte `invitationId` → `404 household.notFound`.

**Annahme** (`v1/invitations/…`, Token im Request-Body statt in der URL, damit er weder in Pfaden noch in Logs landet; Rate-Limit 20 je IP in 15 min für alle drei):

```ts
/** An invitation that can still be accepted, or `invitation.invalid` – one answer for every reason. */
private async open(token: string): Promise<Invitation> {
  const invitation = await this.invitations.findByTokenHash(sha256(token));
  if (
    !invitation ||
    invitation.acceptedAt ||
    invitation.revokedAt ||
    invitation.expiresAt <= this.clock.now()
  ) {
    throw new ApiError(HttpStatus.NOT_FOUND, 'invitation.invalid');
  }
  return invitation;
}
```

- `POST /api/v1/invitations/preview` (`@Public`, `{ token }`): `invitationPreviewSchema` (`accountExists` = User mit der E-Mail existiert; der Token-Inhaber kennt die Adresse ohnehin).
- `POST /api/v1/invitations/accept` (Session, `{ token }`): E-Mail des angemeldeten Users ≠ Einladung → `403 invitation.emailMismatch`; schon Mitglied → Mitgliedschaft unverändert lassen; sonst Mitgliedschaft mit der Rolle der Einladung; `accepted_at` setzen; `last_household_id` = Haushalt; Antwort `me`. Alles in einer Transaktion; `accepted_at` per `UPDATE … WHERE accepted_at IS NULL AND revoked_at IS NULL` setzen und bei 0 Zeilen `invitation.invalid` (gleichzeitige Annahmen).
- `POST /api/v1/invitations/accept-new` (`@Public`, `invitationAcceptNewSchema` mit `token`): User mit der E-Mail existiert → `409 invitation.accountExists`; sonst in einer Transaktion User (E-Mail aus der Einladung, `displayName`, `locale`), Mitgliedschaft, `accepted_at`, `last_household_id`; danach Session `auth_method=invitation` und Session-Cookie (`SessionService.create`, `setSessionCookie` aus `core/identity`); Antwort `me`.

**Tests:** Anlegen als owner → Mail mit Link (In-Memory-`MailSender`), Antwort mit `link`, DB nur Hash; als member → `403`; schon Mitglied → `409 invitation.alreadyMember`; zweite Einladung derselben E-Mail macht die erste ungültig; erneut senden → altes Token `invitation.invalid`, neues gültig; widerrufen → `invitation.invalid`; abgelaufen (Clock) → `invitation.invalid`; angenommen → zweite Annahme `invitation.invalid`; Annahme mit anderer E-Mail → `403 invitation.emailMismatch`; Annahme als schon Mitglied → Rolle unverändert; `accept-new` → User, Mitgliedschaft mit Einladungsrolle, Session-Cookie mit den Flags aus 4a, `me` mit Haushalt; `accept-new` für vorhandenes Konto → `409 invitation.accountExists`, kein zweiter User; zwei gleichzeitige `accept-new` → genau ein Erfolg; Mail aus → Anlegen klappt, Link in der Antwort; Logs enthalten weder Token noch volle E-Mail. **Mandanten-Tabellentest** (`household-tenancy.e2e-spec.ts`): Für jeden Haushaltsendpunkt (Tasks 2–4) mit zwei Haushalten A und B: User aus A mit `householdId` von B → `404`; IDs (Mitglied, Einladung) aus B im Pfad von A → `404`, Daten von B unverändert. Commit(s) `feat(backend): invite members by link and mail`.

---

### Task 5: Instanz-Theme in der DB, Plattform-Admin, `revoke-sessions`

**Files:** `apps/backend/src/core/households/{instance-settings.schema.ts,instance-settings.repository.ts,instance.controller.ts,*.spec.ts}`, `apps/backend/src/core/identity/{require-platform-admin.decorator.ts,platform-admin.guard.ts,sessions.repository.ts,cli/*.ts,index.ts}`, Migration `0004_*.sql`, `infra/deploy/admin.sh` (+ Test in `infra/deploy/test/run-tests.sh`), `docs/runbooks/provisioning.md`, `apps/backend/test/instance-appearance.e2e-spec.ts`, `apps/backend/test/revoke-sessions-cli.e2e-spec.ts`.

**Schema:** `instance_settings` (`id` integer PK mit CHECK `id = 1`, `appearance` jsonb nullable, `updated_at`, `updated_by` → users `on delete set null`).

**Endpunkte:** `GET /api/v1/instance/appearance` (`@Public`; `{ appearance: InstanceAppearance | null }`; gespeicherte Werte beim Lesen erneut mit `instanceAppearanceSchema` geprüft, ungültig → `null`). `PUT` (`@RequirePlatformAdmin()`; `instanceAppearanceUpdateSchema`; Upsert auf `id = 1`; Antwort wie `GET`). `PlatformAdminGuard` (in `core/identity`) lädt den User und wirft `403 auth.forbidden`, wenn `is_platform_admin` falsch ist.

**CLI:** `revoke-sessions --email <e>`: widerruft alle offenen Sessions des Users (`SessionsRepository.revokeAllForUser(userId, at): Promise<number>`), Ausgabe `revoked <n> sessions: <maskierte E-Mail>`; unbekannte E-Mail → Exit 1 `no such user`. `parseCommand` kennt beide Befehle; `USAGE` listet beide. `admin.sh` erlaubt `create-admin` und `revoke-sessions`.

**Tests:** `GET` ohne Session → `null`; `PUT` als Admin → gespeichert, `GET` liefert es; als normaler User → `403 auth.forbidden`; ohne Session → `401`; ungültiges Theme → `400`; `{ appearance: null }` setzt zurück; CLI: zwei Sessions → beide widerrufen (danach `401`), unbekannte E-Mail → Exit 1, Ausgabe maskiert; `admin.sh revoke-sessions` wird gequotet weitergereicht. Commit(s) `feat(backend): store the instance appearance and add revoke-sessions`.

---

### Task 6: Frontend – Instanz-Theme aus der API, Schalter entfernen

**Files:** `apps/frontend/projects/ui/src/lib/theme/{theme.service.ts,theme.service.spec.ts,provide-theme.ts,instance-appearance.token.ts}`, `apps/frontend/projects/ui/src/public-api.ts`, `apps/frontend/projects/ui/README.md`, `apps/frontend/src/app/core/instance/{index.ts,instance-appearance-sync.ts,*.spec.ts}`, `apps/frontend/src/app/app.config.ts`, `apps/frontend/src/app/features/settings/{settings.routes.ts,settings-page.ts,installation-page.ts,*.spec.ts}`, `packages/contracts/src/runtime-config.ts` (+ Spec), `apps/frontend/public/config.json`, `apps/frontend/nginx/40-smart-config.sh`, `infra/compose/{compose.yaml,.env.example,test/compose.test.yaml}`, `infra/deploy/provision.sh` (+ Tests), `tests/e2e/specs/stack-smoke.spec.ts`, `docs/runbooks/provisioning.md`, `CLAUDE.md`.

**ThemeService (in `@smart/ui`):** Das gespeicherte Instanz-Theme im Browser ist ab jetzt nur noch die Kopie des Server-Werts (Boot ohne Netz, kein Aufblitzen). `STORED_INSTANCE_ALLOWED` und `allowStoredInstance` entfallen.

```ts
/** Precedence (spec 3.8): the server's value (cached on the device), config.json, build default. */
private loadInstance(): InstanceAppearance {
  return this.store.loadInstance() ?? this.defaultInstance;
}

/** The server's value; `null` means "none stored", so config.json or the build default applies. Never notifies. */
adoptInstance(value: InstanceAppearance | null): void {
  if (value === null) {
    this.store.clearInstance();
    this.instanceState.set(this.defaultInstance);
    return;
  }
  const parsed = instanceAppearanceSchema.parse(value);
  this.store.saveInstance(parsed);
  this.instanceState.set(parsed);
}
```

`setInstance`/`resetInstance` (Editor) speichern die Kopie und rufen Listener von `onInstanceChange(listener: (value: InstanceAppearance | null) => void): () => void` (wie `onPersonalChange`; `resetInstance` meldet `null`).

**`InstanceAppearanceSync` (`core/instance`, beim Start per `provideEnvironmentInitializer`):** `GET /api/v1/instance/appearance` mit `AbortSignal.timeout(5000)`; Erfolg → `theme.adoptInstance(appearance)`; Fehler → Kopie behalten, nichts melden. Änderungen aus `onInstanceChange` → entprellt 500 ms `PUT`; Fehler → `injectShowApiError()`; die Seite bleibt beim lokalen Wert.

**Einstellungen:** Route `installation` und der Listeneintrag nur für `me().isPlatformAdmin` (Guard `platformAdmin` aus Task 7 – in dieser Task vorläufig als `CanMatchFn` in `settings.routes.ts`, Task 7 verschiebt ihn nach `core/household`); `RuntimeConfig.features` entfällt (Parser ignoriert alte `features`-Felder); `40-smart-config.sh`, compose, `.env.example`, `provision.sh` (keine `SMART_INSTANCE_APPEARANCE_EDITOR`-Zeile mehr schreiben; vorhandene Zeile stört nicht) und Runbook ohne den Schalter.

**Tests:** ThemeService: `adoptInstance(x)` setzt und speichert, meldet nicht; `adoptInstance(null)` → `config.json`-Wert bzw. Build-Standard; nach Neustart des Service gilt die gespeicherte Kopie vor `config.json`; Editor-Änderung meldet genau einmal. Sync: Server-Wert wird übernommen; Server weg → Kopie bleibt; drei schnelle Änderungen → ein `PUT`. Einstellungen: Admin sieht Eintrag und Seite, Nicht-Admin weder Eintrag noch Route (Umleitung auf `/mehr/einstellungen`). `parseRuntimeConfig` ignoriert `features`. Commit(s) `feat(frontend): load the instance appearance from the server`.

---

### Task 7: Frontend – aktueller Haushalt, Guards, Rollen im Rahmen

**Files:** `apps/frontend/src/app/core/household/{index.ts,household-context.ts,guards.ts,*.spec.ts}`, `apps/frontend/src/app/core/auth/auth.service.ts` (öffentliches `reload(): Promise<void>`, falls `load` privat ist), `apps/frontend/src/app/core/features/feature-registry.ts` (+ Spec), `apps/frontend/src/app/features/more/more-page.ts` (+ Spec), `apps/frontend/src/app/shell/{shell.ts,shell.html,shell.spec.ts}`, `apps/frontend/src/app/app.routes.ts` (+ Spec), `apps/frontend/projects/ui/src/lib/icon/icons.json` (+ `pnpm icons:build`: `group`, `person_add`, `swap_horiz`, `content_copy`, `send`, `logout` falls fehlend), `apps/frontend/src/assets/i18n/{de,en}.json`.

**Interfaces (Produces):**

```ts
@Injectable({ providedIn: 'root' })
export class HouseholdContext {
  /** The household the app shows; null while signed out or without any household. */
  readonly current: Signal<HouseholdSummary | null>;
  readonly households: Signal<readonly HouseholdSummary[]>;
  /** Switches on the server (`PUT /api/v1/me`), then adopts the answered `me`. */
  switchTo(householdId: string): Promise<void>;
  /** After a 403/404 on a household path: reload `me`; the guards then lead elsewhere. */
  accessChanged(): Promise<void>;
}
export const hasHousehold: CanMatchFn; // sonst UrlTree('/einrichten')
export function minRole(role: HouseholdRole): CanMatchFn; // sonst UrlTree('/')
export const platformAdmin: CanMatchFn; // sonst UrlTree('/mehr/einstellungen')
```

`current` = Haushalt mit `me.currentHouseholdId`, sonst der erste, sonst `null`. Ein `effect` setzt `UiFormatContext.timeZone` auf `current.timezone` (ohne Haushalt: Browserzone). `AuthService` braucht dafür einen Weg, ein neues `me` zu übernehmen (`adopt(me: Me)`: Signal, Abbild, Status `signedIn`).

**Rahmen und Routen:** Layout-Route `canMatch: [signedIn, hasHousehold]`; `/einrichten` steht außerhalb des Rahmens mit `canMatch: [signedIn]` (Feature aus Task 8). Titel der oberen Leiste = `current().name`; bei mehr als einem Haushalt zusätzlich ein Symbolknopf `swap_horiz` (Label „Haushalt wechseln“) nach `/haushalte`. `MoreEntry` erhält `minRole?: HouseholdRole` und `platformAdminOnly?: boolean`; die „Mehr“-Seite blendet Einträge ohne Recht aus (offline nach dem Abbild).

**Tests:** `current` folgt `currentHouseholdId`, fällt auf den ersten zurück, `null` ohne Haushalte; Zeitzone wechselt sofort beim Wechsel und bei geänderter Zone im neuen `me`; Offline-Start mit Abbild → Zone aus dem Abbild; `hasHousehold` ohne Haushalt → `/einrichten`; `minRole('owner')` als member → `/`; `platformAdmin` als Nicht-Admin → Umleitung; `accessChanged` nach Entfernen (neues `me` ohne den Haushalt) → `current` springt auf einen verbliebenen Haushalt, ohne Haushalt führt die nächste Navigation nach `/einrichten`; „Mehr“-Seite: Eintrag mit `minRole: 'owner'` für member unsichtbar, `platformAdminOnly` nur für Admin; Rahmen zeigt Haushaltsnamen und den Wechselknopf nur bei mehreren Haushalten. Bundle nach der Task messen (Ziel: höchstens +5 kB). Commit(s) `feat(frontend): show the current household and apply roles`.

---

### Task 8: Frontend – Einrichten, Wechseln, Haushaltseinstellungen

**Files:** `apps/frontend/src/app/features/households/{index.ts,households.routes.ts,households-feature.ts,setup-page.ts,switch-page.ts,household-page.ts,time-zones.ts,i18n/{de,en}.json,*.spec.ts}`, `apps/frontend/src/app/app.routes.ts`, `apps/frontend/src/app/app.config.ts` (`provideHouseholdsFeature()`), `apps/frontend/transloco.config.cjs` (Scope `households`).

**Seiten:**

- `/einrichten` (außerhalb des Rahmens, `signedIn`): Name (Vorgabe leer, Platzhalter „Zuhause“), Zeitzone (`ui-select` aus `Intl.supportedValuesOf('timeZone')`, Vorgabe Browserzone) → `POST /api/v1/households` → `auth.adopt(me)` → `/`. Abbrechen nur, wenn schon ein Haushalt existiert (zurück nach `/haushalte`).
- `/haushalte` (im Rahmen): Liste der Haushalte mit Rolle, aktueller markiert; Auswahl → `household.switchTo(id)` → `/`; Eintrag „Neuen Haushalt anlegen“ → `/einrichten`.
- `/mehr/haushalt` (im Rahmen, `minRole('owner')`): Name und Zeitzone ändern (`PATCH`, danach `auth.reload()`); Abschnitt „Haushalt verlassen“ (zweistufiger Knopf, `DELETE .../members/<eigene id>`; `household.lastOwner` → übersetzte Meldung „Ernenne zuerst einen anderen owner“).
- „Mehr“-Einträge: `household` (`home`, `minRole: 'owner'`, Route `/mehr/haushalt`), `members` (`group`, `minRole: 'viewer'`, Route `/mehr/mitglieder`, Seite in Task 9).

Fehler `403`/`404` auf Haushaltspfaden → `household.accessChanged()`; alle anderen → `injectShowApiError()`.

**Tests:** Einrichten legt an und navigiert; Pflichtfeld leer → Fehlermeldung am Feld, kein Request; Wechseln ruft `switchTo` und navigiert; Haushaltsseite speichert Name/Zeitzone, zeigt bei `409 household.lastOwner` die Meldung; Verlassen erst nach zweitem Druck; `404` beim Speichern → `accessChanged`; Texte de/en vorhanden (`pnpm i18n:check`). Commit(s) `feat(frontend): set up, switch and edit households`.

---

### Task 9: Frontend – Mitglieder und Einladungen

**Files:** `apps/frontend/src/app/features/households/{members-page.ts,invite-form.ts,members.api.ts,*.spec.ts,i18n/{de,en}.json}`, `apps/frontend/src/app/features/households/households.routes.ts`.

**Seite `/mehr/mitglieder`** (im Rahmen, `minRole('viewer')`):

- Mitgliederliste (Name, E-Mail, Rolle). Als owner je Mitglied: Rolle ändern (`ui-select`, `PATCH`), entfernen (zweistufig, `DELETE`); eigener Eintrag mit „Verlassen“ (zweistufig). `household.lastOwner` → übersetzte Meldung.
- Nur owner: offene Einladungen (E-Mail, Rolle, gültig bis – `ui-date-time` in Haushaltszone) mit „Erneut senden“ und „Widerrufen“ (zweistufig); Formular „Einladen“ (E-Mail, Rolle, Vorgabe `member`) → `POST`; danach Link-Feld mit „Link kopieren“ (`navigator.clipboard.writeText`, Snackbar „Link kopiert“; ohne Clipboard-API bleibt der Link markierbar sichtbar) und dem Hinweis, dass der Link nur jetzt angezeigt wird.
- `invitation.alreadyMember` → Meldung am E-Mail-Feld.

**Tests:** viewer sieht Liste ohne Bedienelemente und ohne Einladungen; owner ändert Rolle (Request-Body geprüft); Entfernen erst nach zweitem Druck; Einladen zeigt Link und kopiert ihn; erneut senden ersetzt den angezeigten Link; widerrufen entfernt die Zeile; `409 household.lastOwner` und `invitation.alreadyMember` übersetzt; `403` (Rolle inzwischen entzogen) → `accessChanged`. Commit(s) `feat(frontend): manage members and invitations`.

---

### Task 10: Frontend – Einladung annehmen

**Files:** `apps/frontend/src/app/features/invitation/{index.ts,invitation.routes.ts,invitation-page.ts,i18n/{de,en}.json,*.spec.ts}`, `apps/frontend/src/app/app.routes.ts`, `apps/frontend/transloco.config.cjs`.

**Seite `/einladung/:token`** (außerhalb des Rahmens, ohne Guard; Instanz-Theme und Browsersprache wie die Anmelden-Seite): lädt `POST /api/v1/invitations/preview` mit `{ token }`. Die Seite setzt `<meta name="referrer" content="no-referrer">` bzw. `referrerPolicy: 'no-referrer'` für ihre Anfragen, damit der Token nicht als Referer mitreist.

- `invitation.invalid` → Hinweis „Einladung ungültig oder abgelaufen“ mit Link zur Anmeldung.
- Angemeldet: „Du wurdest von <Name> in <Haushalt> als <Rolle> eingeladen“ → „Annehmen“ → `POST /api/v1/invitations/accept` `{ token }` → `auth.adopt(me)` → `/`. `invitation.emailMismatch` → Hinweis mit der eingeladenen Adresse und „Abmelden und mit dieser Adresse anmelden“.
- Nicht angemeldet, `accountExists`: „Melde dich mit <E-Mail> an“ → `/anmelden?ziel=/einladung/<token>` (`safeTarget` muss den Pfad zulassen).
- Nicht angemeldet, ohne Konto: Feld „Dein Name“ → `POST /api/v1/invitations/accept-new` `{ token, displayName, locale }` (`locale` = aktive Sprache) → `auth.adopt(me)` → `/`. `invitation.accountExists` → wie `accountExists`.
- Der Token erscheint nicht im Seitentitel und wird nicht im Abbild gespeichert.

**Tests:** alle fünf Zweige; nach `accept-new` ist der User angemeldet und im Haushalt; `ziel` führt nach der Anmeldung zurück auf die Einladung; ungültig zeigt den Hinweis ohne Formular. Commit(s) `feat(frontend): accept invitations`.

---

### Task 11: Stack-Test, E2E, Doku

**Files:** `tests/e2e/global-setup.ts` (jedes Testkonto bekommt per API einen Haushalt), `tests/e2e/helpers/{accounts.ts,households.ts}`, `tests/e2e/specs/households.spec.ts`, `infra/compose/test/stack-test.sh` (neue Testkonten `e2e-setup@example.org` ohne Haushalt und `e2e-owner@example.org`; `global-setup` gibt allen Konten außer `setup` einen Haushalt), Architektur-Spec (7.1/8.4 prüfen, Einrichtungsseite), `docs/runbooks/provisioning.md` (`revoke-sessions`, kein Editor-Schalter mehr, Instanz-Theme in der App), `CLAUDE.md` (Laufzeitkonfiguration ohne Editor-Schalter, Bundle-Stand), Stage-4-Spec nur bei Abweichungen.

**E2E (Playwright, Mailpit wie in 4a):**

1. Konto `setup` (ohne Haushalt) → nach der Anmeldung `/einrichten` → Haushalt „Testhaus“, Zone `Pacific/Chatham` → Übersicht mit Titel „Testhaus“.
2. owner lädt eine neue Adresse als `viewer` ein → Link aus der Antwort (nicht aus Mailpit, damit der Test auch ohne Mail läuft) → neuer Browserkontext: Name eingeben → angemeldet im Haushalt; „Mehr“ zeigt „Mitglieder“, aber nicht „Haushalt“; Mitgliederseite ohne Bedienelemente.
3. Einladung an ein vorhandenes Konto → Mail in Mailpit enthält den Link → Konto meldet sich über `ziel` an und nimmt an → zweiter Haushalt → Wechselknopf in der oberen Leiste → `/haushalte` → Wechsel ändert den Titel.
4. owner entfernt den viewer → viewer-Kontext lädt neu → `/einrichten`.
5. Plattform-Admin ändert das Instanz-Theme → anderer, nicht angemeldeter Kontext auf `/anmelden` zeigt die neue Grundfarbe (Theme-Variable am `:root` prüfen).

Pro Adresse höchstens zwei Code-Anforderungen (Limit 3/15 min, siehe 4a); bestehende Specs bleiben grün, weil `global-setup` ihren Konten einen Haushalt gibt. Commit(s) `test(infra): cover households and invitations in the stack` und `docs: describe households, invitations and revoke-sessions`.
