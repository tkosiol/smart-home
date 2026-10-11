# Etappe 2: Durchstich bis Produktion – Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein Commit auf `main` läuft vollautomatisch durch Build → Image-Scan → Staging → manuelle Freigabe → Produktion; beide Umgebungen laufen auf dem VPS hinter dem Reverse Proxy mit Datenbank, Broker, Health-Checks, nächtlichen verschlüsselten Backups mit monatlichem Restore-Test und externer Überwachung.

**Architecture:** Das Backend bekommt Konfigurationsprüfung, strukturiertes Logging, Datenbank (Drizzle + postgres.js, erste Migration aktiviert TimescaleDB), MQTT-Verbindung und einen Readiness-Check. Vier Images (`api`, `web`, `broker`, `backup`) werden einmal pro Commit gebaut, mit Trivy gescannt und nach GHCR gepusht. Ein Compose-Stack pro Umgebung läuft auf dem VPS ohne Root-Rechte; GitHub Actions deployt per SSH-Key, der auf einen Forced Command beschränkt ist, der nur Commits auf `main` akzeptiert und das Deploy-Skript dieses Commits ausführt (inkl. automatischem Rollback). Backups laufen als Container im Produktions-Stack.

**Tech Stack:** NestJS 12, Drizzle ORM 0.45.4 + postgres.js 3.4.9, mqtt 5.16.0, nestjs-pino 5.3.1, Testcontainers 12.2.0, Playwright 1.64.0, Docker/Compose, nginx-unprivileged, restic + supercronic, GitHub Actions (Environments), Trivy.

**Spec:** `docs/superpowers/specs/2026-10-11-smart-home-architecture-design.md` (Abschnitte 3, 6, 8.9–8.10, 9, 10.9 Security-Header, 11, 13 – Etappe 2)

## Global Constraints

- Node 24.21.0, pnpm 12.11.2, TypeScript 6.0.3, Angular 22.2.x, NestJS 12.x (ESM) – wie Etappe 1.
- Neue Paketversionen exakt: `drizzle-orm@0.45.4`, `drizzle-kit@0.31.11`, `postgres@3.4.9`, `mqtt@5.16.0`, `nestjs-pino@5.3.1`, `pino@10.4.0`, `pino-http@11.0.0`, `testcontainers@12.2.0`, `@testcontainers/postgresql@12.2.0`, `@playwright/test@1.64.0`.
- Basis-Images: `node:24.21.0-alpine3.24`, `nginxinc/nginx-unprivileged:1.31.6-alpine3.24`, `alpine:3.24.2`, `timescale/timescaledb:2.30.2-pg17`, `eclipse-mosquitto:2.1.2-alpine`, `koalaman/shellcheck:v0.11.0`.
- Neue Actions (SHA-gepinnt): `docker/login-action@dbcb813823bdd20940b903addbd779551569679f` (v4.6.0), `docker/setup-buildx-action@f87e5991a6d7451dcb8d9637bfbc97413f497069` (v4.4.1), `docker/build-push-action@c3c9e263c25d99ce0380d002d59b67737d91b0dc` (v7.4.0), `aquasecurity/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25` (v0.36.0); bestehende Pins aus Etappe 1 unverändert.
- Image-Namen: `ghcr.io/tkosiol/smart-home-{api,web,broker,backup}:<40-stelliger Commit-SHA>`.
- Stacks auf dem VPS: `~/docker/apps/smart-staging` (Domain `staging.smart.tillkosiol.de`) und `~/docker/apps/smart-prod` (Domain `smart.tillkosiol.de`); Compose-Projektname = `STACK_NAME` = Verzeichnisname.
- **Kein Root auf dem VPS** (sudo verlangt ein Passwort): keine Paketinstallation, keine systemd-Units, keine UFW-Änderungen. Alles läuft in Docker oder unter dem User des Deploy-Accounts.
- **Secrets** (DB-/MQTT-Passwörter, B2-Keys, restic-Passwort, Healthcheck-URLs, Deploy-Keys) erscheinen nie im Repo, nie im Chat, nie in CI-Logs. Laufzeit-Secrets entstehen ausschließlich über `infra/deploy/provision.sh`, das Till selbst im Terminal ausführt.
- Öffentliches Repo: keine IP-Adressen, Bucket-Namen, Hostnamen privater Geräte oder E-Mail-Adressen in versionierten Dateien; Platzhalter `<VPS_HOST>`, `<DEPLOY_USER>`, `<B2_BUCKET>`.
- Alle Container: `TZ=UTC`, Log-Rotation (`json-file`, `max-size: 10m`, `max-file: 5`), wo möglich `read_only: true` + `tmpfs: /tmp`, Nicht-Root-User.
- Code/Kommentare/Commits Englisch, Doku Deutsch, Conventional Commits, keine KI-Attribution.
- Arbeit auf Branch `feat/etappe-2-durchstich`; Push und Merge erst in Task 14 nach Tills Freigabe.

## Review Focus

1. **Ein Commit, der nicht auf `main` liegt, oder der Staging-Key deployt nach Produktion.** Erwartet: Ablehnung ohne jede Docker-Aktion. → Wrapper-Tests in Task 10, Schritt 1.
2. **Fehlgeschlagene Migration oder ungesunde neue Version legt Produktion lahm.** Erwartet: Migration bricht vor dem Austausch ab; ungesunde Version wird automatisch auf den vorherigen Stand zurückgesetzt. → deploy.sh-Tests in Task 10, Schritt 1.
3. **Backup scheitert still** (pg_dump-Fehler verschluckt, leerer Dump als Erfolg) oder Restore wird nie geprüft. Erwartet: Exit-Code ≠ 0 und kein neuer Snapshot (der Exit-Trap meldet dann „fail“ an healthchecks.io). → Negativtest in Task 8, Schritt 6; Restore-Test in Task 8, Schritt 5.
4. **Secrets tauchen in Logs oder lesbaren Dateien auf.** Erwartet: Cookie/Authorization im Log geschwärzt, Fehlermeldungen der Konfiguration ohne Werte, `.env` mit Rechten 600. → Task 2 Schritt 1, Task 5 Schritt 1, Task 10 Schritt 1 (provision).
5. **Der Browser blockiert die App wegen CSP, oder Security-Header fehlen auf einzelnen Antworten** (nginx-`add_header`-Vererbung). Erwartet: keine Konsolenfehler, Header auf HTML, Deep-Links, Assets und API. → Playwright-Smoke in Task 9.

---

## Dateistruktur (neu/geändert)

```
apps/backend/
├── Dockerfile
├── drizzle.config.ts
├── drizzle/0000_enable_timescaledb.sql, drizzle/meta/_journal.json
├── src/main.ts, src/migrate.ts, src/app.module.ts, src/app.setup.ts
├── src/platform/config/{env.schema.ts, env.schema.spec.ts, env.token.ts, config.module.ts, index.ts}
├── src/platform/database/{database.client.ts, migrations.ts, database.health.ts, database.module.ts, index.ts}
├── src/platform/mqtt/{mqtt.connection.ts, mqtt.health.ts, mqtt.module.ts, index.ts}
├── src/platform/observability/{health.controller.ts, readiness.service.ts, http-logger.options.ts,
│                               http-logger.options.spec.ts, logging.module.ts, observability.module.ts, index.ts}
└── test/{global-setup.ts, setup-env.ts, helpers/fresh-database.ts, database.e2e-spec.ts, mqtt.e2e-spec.ts, health.e2e-spec.ts}
apps/frontend/{Dockerfile, nginx/default.conf, nginx/security-headers.conf, src/index.html, angular.json}
packages/contracts/src/health.ts (+ spec)
infra/broker/{Dockerfile, mosquitto.conf, entrypoint.sh}          (aus infra/local/mosquitto verschoben)
infra/backup/{Dockerfile, crontab, backup.sh, restore-test.sh}
infra/compose/{compose.yaml, .env.example, test/compose.test.yaml, test/stack-test.sh}
infra/deploy/{smart-deploy, deploy.sh, provision.sh, test/run-tests.sh, test/stubs/{docker,curl,ssh}}
infra/github/ruleset-main.json
tests/e2e/{package.json, playwright.config.ts, specs/stack-smoke.spec.ts}
.github/workflows/{ci.yml, deploy.yml, deploy-environment.yml}
.dockerignore
docs/runbooks/{deploy.md, provisioning.md, backup-restore.md, monitoring.md}
docs/adr/{0016-…, 0017-…}, docs/superpowers/specs/…-design.md, CLAUDE.md, pnpm-workspace.yaml
```

---

### Task 1: Repo-Hygiene und Spec-Nachträge

Erledigt die aufgeschobenen Kleinigkeiten aus der Etappe-1-Review, die den Deploy-Pfad berühren, und trägt die Entscheidungen seit der Spec-Freigabe nach.

**Files:**

- Modify: `.github/workflows/ci.yml`, `infra/github/ruleset-main.json`, `apps/backend/package.json`, `apps/backend/vitest.config.ts`, `apps/backend/vitest.config.e2e.ts`, `.gitignore`
- Modify: `docs/superpowers/specs/2026-10-11-smart-home-architecture-design.md`, `docs/adr/0007-passwordless-login.md`, `docs/adr/0016-forced-command-deploy.md`, `docs/adr/0017-backups-restic-b2.md`

**Interfaces:** keine Code-Schnittstellen.

- [ ] **Step 1: Branch anlegen**

```bash
git switch feat/etappe-2-durchstich 2>/dev/null || { git switch main && git pull --ff-only && git switch -c feat/etappe-2-durchstich; }
```

- [ ] **Step 2: CI – Abbruch nur bei PRs, gitleaks per Digest**

In `.github/workflows/ci.yml`:

- `cancel-in-progress: true` ersetzen durch `cancel-in-progress: ${{ github.event_name == 'pull_request' }}`
- `ghcr.io/gitleaks/gitleaks:v8.30.1` ersetzen durch `ghcr.io/gitleaks/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f`

- [ ] **Step 3: Ruleset – Checks an GitHub Actions binden**

In `infra/github/ruleset-main.json` jeden Eintrag in `required_status_checks` um `"integration_id": 15368` ergänzen, z. B. `{ "context": "verify", "integration_id": 15368 }`.

- [ ] **Step 4: Backend auf Vitest 5 ohne Zusatz-Plugin**

```bash
pnpm --filter @smart/backend remove @vitest/coverage-v8 vite-tsconfig-paths
pnpm --filter @smart/backend add -D --save-exact vitest@5.0.3
```

In `apps/backend/vitest.config.ts` und `apps/backend/vitest.config.e2e.ts` den Import `vite-tsconfig-paths` und `plugins: [tsconfigPaths()]` entfernen und stattdessen auf oberster Ebene `resolve: { tsconfigPaths: true },` setzen.

- [ ] **Step 5: `.gitignore` ergänzen**

Unter `# private, never committed` die Zeile `.superpowers/` hinzufügen.

- [ ] **Step 6: Spec-Nachträge**

In der Spec:

- Abschnitt 3.3, Satz zu Resend ersetzen durch: „Resend nutzt die bereits verifizierte Domain `tillkosiol.de` (Region eu-west-1); Absender z. B. `Smart Home <smart@tillkosiol.de>`. Eine eigene Absender-Subdomain ist nicht nötig.“
- Abschnitt 11.3, Punkt „VPS (nächtlich, systemd-Timer)“ ersetzen durch: „**VPS (nächtlich, Container `backup` im Produktions-Stack, supercronic):** `pg_dump` (Custom-Format) per `restic --stdin-from-command`, Stack-Verzeichnis (Compose-Datei, `.env`). Kein Host-Dienst, da auf dem VPS keine Root-Rechte verfügbar sind.“
- Abschnitt 11.3, Punkt „Restore-Test“ ersetzen durch: „**Restore-Test (monatlich, automatisiert):** Wiederherstellung des letzten Dumps in eine Wegwerf-Datenbank `restore_check` derselben Instanz, Prüfung der Migrationstabelle, danach Löschen; Ergebnis an healthchecks.io.“
- Abschnitt 13, Etappe 2: „inkl. Health, Deploy-Skript, Backups, Monitoring“ ergänzen um „(Backups des VPS; Pi-Backups folgen in Etappe 5)“; Etappe 5 ergänzen um „, Pi-Backups“.

In `docs/adr/0007-passwordless-login.md` unter „Konsequenzen“ anhängen: „Absenderdomain ist die bereits bei Resend verifizierte Domain `tillkosiol.de` (eu-west-1).“

`docs/adr/0016-forced-command-deploy.md`, Abschnitt „Entscheidung“ ersetzen durch: „SSH-Key pro Environment, in `authorized_keys` auf `command="…/smart-deploy <environment>",restrict` beschränkt. Der Wrapper akzeptiert nur `deploy <sha>`, prüft per GitHub-API, dass der Commit auf `main` liegt, lädt `infra/deploy/deploy.sh` und `infra/compose/compose.yaml` genau dieses Commits und führt sie aus.“ – „Konsequenzen“ ergänzen: „Ein gestohlener Deploy-Key kann nur bereits auf `main` vorhandene Commits in seine eigene Umgebung deployen. Änderungen am Wrapper selbst müssen manuell auf den VPS kopiert werden (Runbook).“

`docs/adr/0017-backups-restic-b2.md`, Abschnitt „Entscheidung“ ersetzen durch: „restic (verschlüsselt) nach Backblaze B2 (EU), ausgeführt von einem `backup`-Container im Produktions-Stack (supercronic): nächtlich DB-Dump und Stack-Konfiguration, Aufbewahrung 7/4/6, monatlicher Restore-Test in eine Wegwerf-Datenbank.“

- [ ] **Step 7: Verifizieren**

```bash
docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:latest -color
python3 -m json.tool infra/github/ruleset-main.json > /dev/null && echo "ruleset json ok"
pnpm --filter @smart/backend test
pnpm peers check
```

Expected: actionlint ohne Ausgabe; `ruleset json ok`; Backend-Tests grün (2 e2e-Tests); `pnpm peers check` meldet keine `tsconfck`-Warnung mehr.

- [ ] **Step 8: Commit**

```bash
pnpm format
git add -A
git commit -m "chore(repo): tidy CI pins, backend vitest and record decisions in spec"
```

---

### Task 2: Health-Contracts und Konfigurationsprüfung

**Files:**

- Modify: `packages/contracts/src/health.ts`, `packages/contracts/src/health.spec.ts`
- Create: `apps/backend/src/platform/config/env.schema.ts`, `env.schema.spec.ts`, `env.token.ts`, `config.module.ts`, `index.ts`
- Modify: `apps/backend/package.json` (Test-Skript)

**Interfaces:**

- Produces (`@smart/contracts`): `dependencyStatusSchema` (`'up' | 'down'`), `type DependencyStatus`, `healthReadyResponseSchema` (`{ status: 'ok' | 'unavailable', checks: { database: DependencyStatus, broker: DependencyStatus } }`), `type HealthReadyResponse`.
- Produces (`platform/config`): `loadEnv(source: Record<string, string | undefined>): Env`, `type Env = { NODE_ENV, PORT: number, LOG_LEVEL, DATABASE_URL, MQTT_URL, MQTT_USERNAME, MQTT_PASSWORD }`, Injection-Token `ENV` (Symbol), `ConfigModule` (global).

- [ ] **Step 1: Failing tests**

An `packages/contracts/src/health.spec.ts` anhängen:

```ts
describe('healthReadyResponseSchema', () => {
  it('accepts a ready service', () => {
    const value = { status: 'ok', checks: { database: 'up', broker: 'up' } };
    expect(healthReadyResponseSchema.parse(value)).toEqual(value);
  });

  it('accepts an unavailable service', () => {
    const value = { status: 'unavailable', checks: { database: 'down', broker: 'up' } };
    expect(healthReadyResponseSchema.parse(value)).toEqual(value);
  });

  it.each([
    { status: 'ok' },
    { status: 'ok', checks: { database: 'up' } },
    { status: 'fine', checks: { database: 'up', broker: 'up' } },
    { status: 'ok', checks: { database: 'maybe', broker: 'up' } },
  ])('rejects %j', (value) => {
    expect(healthReadyResponseSchema.safeParse(value).success).toBe(false);
  });
});
```

Import-Zeile der Datei erweitern: `import { healthLiveResponseSchema, healthReadyResponseSchema } from './health.js';`

`apps/backend/src/platform/config/env.schema.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.schema.js';

const valid = {
  DATABASE_URL: 'postgres://smart:secret@db:5432/smart',
  MQTT_URL: 'mqtt://broker:1883',
  MQTT_USERNAME: 'smart-api',
  MQTT_PASSWORD: 'mqtt-secret',
};

describe('loadEnv', () => {
  it('applies defaults', () => {
    expect(loadEnv(valid)).toEqual({
      ...valid,
      NODE_ENV: 'development',
      PORT: 3000,
      LOG_LEVEL: 'info',
    });
  });

  it('coerces PORT to a number', () => {
    expect(loadEnv({ ...valid, PORT: '8080' }).PORT).toBe(8080);
  });

  it('accepts postgresql:// and mqtts:// URLs', () => {
    const env = loadEnv({
      ...valid,
      DATABASE_URL: 'postgresql://a:b@h/d',
      MQTT_URL: 'mqtts://h:8883',
    });
    expect(env.MQTT_URL).toBe('mqtts://h:8883');
  });

  it('names every missing variable', () => {
    expect(() => loadEnv({})).toThrowError(
      /DATABASE_URL[\s\S]*MQTT_URL[\s\S]*MQTT_USERNAME[\s\S]*MQTT_PASSWORD/,
    );
  });

  it('never echoes secret values in the error', () => {
    let message = '';
    try {
      loadEnv({
        ...valid,
        DATABASE_URL: 'mysql://smart:super-secret-pw@db/smart',
        PORT: 'not-a-port',
      });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('DATABASE_URL');
    expect(message).toContain('PORT');
    expect(message).not.toContain('super-secret-pw');
  });
});
```

- [ ] **Step 2: Tests laufen lassen – müssen fehlschlagen**

Run: `pnpm --filter @smart/contracts test; pnpm --filter @smart/backend exec vitest run src/platform/config`
Expected: FAIL – `healthReadyResponseSchema` ist kein Export; `Cannot find module './env.schema.js'`.

- [ ] **Step 3: Implementierung**

An `packages/contracts/src/health.ts` anhängen:

```ts
export const dependencyStatusSchema = z.enum(['up', 'down']);
export type DependencyStatus = z.infer<typeof dependencyStatusSchema>;

export const healthReadyResponseSchema = z.object({
  status: z.enum(['ok', 'unavailable']),
  checks: z.object({
    database: dependencyStatusSchema,
    broker: dependencyStatusSchema,
  }),
});
export type HealthReadyResponse = z.infer<typeof healthReadyResponseSchema>;
```

`apps/backend/src/platform/config/env.schema.ts`:

```ts
import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  MQTT_URL: z.url({ protocol: /^mqtts?$/ }),
  MQTT_USERNAME: z.string().min(1),
  MQTT_PASSWORD: z.string().min(1),
});
export type Env = z.infer<typeof envSchema>;

/** Validates the process environment once at startup; the error lists keys, never values. */
export function loadEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.code}`);
    throw new Error(`Invalid environment configuration:\n- ${problems.join('\n- ')}`);
  }
  return result.data;
}
```

`apps/backend/src/platform/config/env.token.ts`:

```ts
export const ENV = Symbol('ENV');
```

`apps/backend/src/platform/config/config.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import { loadEnv, type Env } from './env.schema.js';
import { ENV } from './env.token.js';

@Global()
@Module({
  providers: [{ provide: ENV, useFactory: (): Env => loadEnv(process.env) }],
  exports: [ENV],
})
export class ConfigModule {}
```

`apps/backend/src/platform/config/index.ts`:

```ts
export { ConfigModule } from './config.module.js';
export { loadEnv, type Env } from './env.schema.js';
export { ENV } from './env.token.js';
```

In `apps/backend/package.json` beim `test`-Skript `--passWithNoTests` entfernen (es gibt jetzt Unit-Tests).

- [ ] **Step 4: Tests laufen lassen – müssen bestehen**

Run: `pnpm --filter @smart/contracts test && pnpm contracts:build && pnpm --filter @smart/backend test`
Expected: PASS (Contracts inkl. neuer Fälle; Backend: 5 Unit-Tests + 2 e2e-Tests).

- [ ] **Step 5: Commit**

```bash
pnpm format
git add packages/contracts apps/backend
git commit -m "feat(backend): validate environment and add readiness contract"
```

---

### Task 3: Datenbank-Plattform (Drizzle, Migrationen, Health)

**Files:**

- Create: `apps/backend/drizzle.config.ts`, `apps/backend/drizzle/0000_enable_timescaledb.sql`, `apps/backend/drizzle/meta/_journal.json`
- Create: `apps/backend/src/platform/database/{database.client.ts, migrations.ts, database.health.ts, database.module.ts, index.ts}`, `apps/backend/src/migrate.ts`
- Create: `apps/backend/test/{global-setup.ts, setup-env.ts, helpers/fresh-database.ts, database.e2e-spec.ts}`
- Modify: `apps/backend/vitest.config.e2e.ts`, `apps/backend/package.json`

**Interfaces:**

- Consumes: `Env`, `ENV`, `loadEnv` (Task 2); `DependencyStatus` (`@smart/contracts`).
- Produces: `createDatabaseConnection(url: string): DatabaseConnection` mit `{ db: PostgresJsDatabase; sql: postgres.Sql }`; `runMigrations(url: string): Promise<void>`; `MIGRATIONS_FOLDER: string`; Klasse `DatabaseHealth` mit `check(timeoutMs?: number): Promise<DependencyStatus>`; Token `DATABASE`; `DatabaseModule` (global). Test-Kontext: `inject('testEnv')` liefert `{ DATABASE_URL, MQTT_URL, MQTT_USERNAME, MQTT_PASSWORD }` (MQTT ab Task 4).

- [ ] **Step 1: Abhängigkeiten**

```bash
pnpm --filter @smart/backend add --save-exact drizzle-orm@0.45.4 postgres@3.4.9
pnpm --filter @smart/backend add -D --save-exact drizzle-kit@0.31.11 testcontainers@12.2.0 @testcontainers/postgresql@12.2.0
```

Meldet pnpm blockierte Build-Skripte (z. B. `esbuild` für drizzle-kit, `cpu-features`/`ssh2` für testcontainers), nur die genannten Pakete per `pnpm approve-builds <paket>` freigeben.

- [ ] **Step 2: Test-Infrastruktur (Testcontainers)**

`apps/backend/test/global-setup.ts`:

```ts
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { TestProject } from 'vitest/node';

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const database = await new PostgreSqlContainer('timescale/timescaledb:2.30.2-pg17')
    .withDatabase('smart')
    .withUsername('smart')
    .withPassword('smart-test')
    // A non-UTC server default proves that our client forces UTC per session.
    .withCommand(['postgres', '-c', 'timezone=Europe/Berlin'])
    .start();

  project.provide('testEnv', {
    DATABASE_URL: database.getConnectionUri(),
    MQTT_URL: 'mqtt://127.0.0.1:1',
    MQTT_USERNAME: 'unused',
    MQTT_PASSWORD: 'unused',
  });

  return async () => {
    await database.stop();
  };
}

declare module 'vitest' {
  export interface ProvidedContext {
    testEnv: Record<'DATABASE_URL' | 'MQTT_URL' | 'MQTT_USERNAME' | 'MQTT_PASSWORD', string>;
  }
}
```

`apps/backend/test/setup-env.ts`:

```ts
import { inject } from 'vitest';

Object.assign(process.env, inject('testEnv'), { NODE_ENV: 'test', LOG_LEVEL: 'silent' });
```

`apps/backend/test/helpers/fresh-database.ts`:

```ts
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';

/** Creates an empty database on the test server and returns its URL. */
export async function createFreshDatabase(baseUrl: string): Promise<string> {
  const admin = postgres(baseUrl, { max: 1, onnotice: () => undefined });
  const name = `t_${randomUUID().replaceAll('-', '')}`;
  try {
    await admin.unsafe(`create database ${name}`);
  } finally {
    await admin.end();
  }
  const url = new URL(baseUrl);
  url.pathname = `/${name}`;
  return url.toString();
}
```

`apps/backend/vitest.config.e2e.ts` vollständig:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    globalSetup: ['./test/global-setup.ts'],
    setupFiles: ['./test/setup-env.ts'],
    testTimeout: 30_000,
    hookTimeout: 180_000,
  },
});
```

- [ ] **Step 3: Failing tests**

`apps/backend/test/database.e2e-spec.ts`:

```ts
import postgres from 'postgres';
import { inject } from 'vitest';
import {
  DatabaseHealth,
  createDatabaseConnection,
  runMigrations,
} from '../src/platform/database/index.js';
import { createFreshDatabase } from './helpers/fresh-database.js';

const { DATABASE_URL } = inject('testEnv');

async function query<T extends Record<string, unknown>>(url: string, text: string): Promise<T[]> {
  const sql = postgres(url, { max: 1, onnotice: () => undefined });
  try {
    return (await sql.unsafe(text)) as unknown as T[];
  } finally {
    await sql.end();
  }
}

describe('runMigrations', () => {
  it('enables TimescaleDB and records the migration on an empty database', async () => {
    const url = await createFreshDatabase(DATABASE_URL);
    await runMigrations(url);

    const extensions = await query<{ extname: string }>(
      url,
      "select extname from pg_extension where extname = 'timescaledb'",
    );
    const applied = await query<{ count: string }>(
      url,
      'select count(*)::text as count from drizzle.__drizzle_migrations',
    );
    expect(extensions).toHaveLength(1);
    expect(applied[0]?.count).toBe('1');
  });

  it('is idempotent', async () => {
    const url = await createFreshDatabase(DATABASE_URL);
    await runMigrations(url);
    await runMigrations(url);

    const applied = await query<{ count: string }>(
      url,
      'select count(*)::text as count from drizzle.__drizzle_migrations',
    );
    expect(applied[0]?.count).toBe('1');
  });
});

describe('createDatabaseConnection', () => {
  it('forces UTC per session even when the server default differs', async () => {
    const connection = createDatabaseConnection(DATABASE_URL);
    try {
      const rows = await connection.sql`show timezone`;
      expect(rows[0]?.TimeZone).toBe('UTC');
    } finally {
      await connection.sql.end();
    }
  });
});

describe('DatabaseHealth', () => {
  it('reports up for a reachable database', async () => {
    const connection = createDatabaseConnection(DATABASE_URL);
    try {
      expect(await new DatabaseHealth(connection).check()).toBe('up');
    } finally {
      await connection.sql.end();
    }
  });

  it('reports down within the timeout for an unreachable database', async () => {
    const connection = createDatabaseConnection('postgres://smart:x@127.0.0.1:1/smart');
    const started = Date.now();
    try {
      expect(await new DatabaseHealth(connection).check(1000)).toBe('down');
      expect(Date.now() - started).toBeLessThan(3000);
    } finally {
      await connection.sql.end({ timeout: 0 });
    }
  });
});
```

- [ ] **Step 4: Test laufen lassen – muss fehlschlagen**

Run: `pnpm --filter @smart/backend exec vitest run --config vitest.config.e2e.ts test/database.e2e-spec.ts`
Expected: FAIL – `Cannot find module '../src/platform/database/index.js'`.

- [ ] **Step 5: Migration und Drizzle-Konfiguration**

`apps/backend/drizzle.config.ts`:

```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/**/*.schema.ts',
  out: './drizzle',
  migrations: { schema: 'drizzle', table: '__drizzle_migrations' },
});
```

Erste Migration als Custom-Migration erzeugen:

```bash
pnpm --filter @smart/backend exec drizzle-kit generate --custom --name enable_timescaledb
```

Bricht drizzle-kit ab, weil es noch keine `*.schema.ts` gibt, die beiden Dateien von Hand anlegen:

`apps/backend/drizzle/meta/_journal.json`:

```json
{
  "version": "7",
  "dialect": "postgresql",
  "entries": [
    {
      "idx": 0,
      "version": "7",
      "when": 1791720000000,
      "tag": "0000_enable_timescaledb",
      "breakpoints": true
    }
  ]
}
```

Inhalt der Migration (generierte oder handangelegte Datei `apps/backend/drizzle/0000_enable_timescaledb.sql`):

```sql
CREATE EXTENSION IF NOT EXISTS timescaledb;
```

Heißt die generierte Datei anders (z. B. mit Zufallssuffix), den Dateinamen und `tag` im Journal auf `0000_enable_timescaledb` vereinheitlichen.

- [ ] **Step 6: Implementierung**

`apps/backend/src/platform/database/database.client.ts`:

```ts
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

export interface DatabaseConnection {
  readonly db: PostgresJsDatabase;
  readonly sql: postgres.Sql;
}

/** All sessions run in UTC, independent of the server default (spec §9). */
export function createDatabaseConnection(url: string): DatabaseConnection {
  const sql = postgres(url, {
    max: 10,
    connect_timeout: 5,
    connection: { TimeZone: 'UTC', application_name: 'smart-api' },
    onnotice: () => undefined,
  });
  return { sql, db: drizzle(sql) };
}
```

`apps/backend/src/platform/database/migrations.ts`:

```ts
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

/** apps/backend/drizzle – resolves from src/ (tests) and dist/ (container) alike. */
export const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../../drizzle', import.meta.url));

export async function runMigrations(url: string): Promise<void> {
  const sql = postgres(url, { max: 1, connection: { TimeZone: 'UTC' }, onnotice: () => undefined });
  try {
    await migrate(drizzle(sql), {
      migrationsFolder: MIGRATIONS_FOLDER,
      migrationsSchema: 'drizzle',
      migrationsTable: '__drizzle_migrations',
    });
  } finally {
    await sql.end();
  }
}
```

`apps/backend/src/platform/database/database.health.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import type { DependencyStatus } from '@smart/contracts';
import type { DatabaseConnection } from './database.client.js';
import { DATABASE } from './database.token.js';

@Injectable()
export class DatabaseHealth {
  constructor(@Inject(DATABASE) private readonly connection: DatabaseConnection) {}

  async check(timeoutMs = 2000): Promise<DependencyStatus> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('database health check timed out')), timeoutMs);
    });
    try {
      await Promise.race([this.connection.sql`select 1`, timeout]);
      return 'up';
    } catch {
      return 'down';
    } finally {
      clearTimeout(timer);
    }
  }
}
```

`apps/backend/src/platform/database/database.token.ts`:

```ts
export const DATABASE = Symbol('DATABASE');
```

`apps/backend/src/platform/database/database.module.ts`:

```ts
import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ENV, type Env } from '../config/index.js';
import { createDatabaseConnection, type DatabaseConnection } from './database.client.js';
import { DatabaseHealth } from './database.health.js';
import { DATABASE } from './database.token.js';

@Injectable()
class DatabaseLifecycle implements OnApplicationShutdown {
  constructor(@Inject(DATABASE) private readonly connection: DatabaseConnection) {}

  async onApplicationShutdown(): Promise<void> {
    await this.connection.sql.end({ timeout: 5 });
  }
}

@Global()
@Module({
  providers: [
    {
      provide: DATABASE,
      inject: [ENV],
      useFactory: (env: Env): DatabaseConnection => createDatabaseConnection(env.DATABASE_URL),
    },
    DatabaseHealth,
    DatabaseLifecycle,
  ],
  exports: [DATABASE, DatabaseHealth],
})
export class DatabaseModule {}
```

`apps/backend/src/platform/database/index.ts`:

```ts
export { createDatabaseConnection, type DatabaseConnection } from './database.client.js';
export { DatabaseHealth } from './database.health.js';
export { DatabaseModule } from './database.module.js';
export { DATABASE } from './database.token.js';
export { MIGRATIONS_FOLDER, runMigrations } from './migrations.js';
```

`apps/backend/src/migrate.ts`:

```ts
import { loadEnv } from './platform/config/index.js';
import { runMigrations } from './platform/database/index.js';

const env = loadEnv(process.env);
await runMigrations(env.DATABASE_URL);
console.log('migrations applied');
```

In `apps/backend/package.json` bei `scripts` ergänzen: `"migrate": "node dist/migrate.js"`.

- [ ] **Step 7: Tests laufen lassen – müssen bestehen**

Run: `pnpm --filter @smart/backend exec vitest run --config vitest.config.e2e.ts test/database.e2e-spec.ts`
Expected: PASS (5 Tests). Der erste Lauf lädt das TimescaleDB-Image und dauert länger.

- [ ] **Step 8: Build prüfen – Migrationen werden im dist-Pfad gefunden**

```bash
pnpm --filter @smart/backend build
pnpm infra:up
DATABASE_URL=postgres://smart:smart-local-only@127.0.0.1:5433/smart MQTT_URL=mqtt://127.0.0.1:1884 MQTT_USERNAME=smart-dev MQTT_PASSWORD=smart-dev-only node apps/backend/dist/migrate.js
```

Expected: `migrations applied`.

- [ ] **Step 9: Commit**

```bash
pnpm format && pnpm lint
git add apps/backend pnpm-lock.yaml pnpm-workspace.yaml
git commit -m "feat(backend): add database platform with migrations and health check"
```

---

### Task 4: Broker-Konfiguration und MQTT-Plattform

**Files:**

- Move: `infra/local/mosquitto/mosquitto.conf` → `infra/broker/mosquitto.conf`, `infra/local/mosquitto/entrypoint.sh` → `infra/broker/entrypoint.sh`
- Modify: `infra/local/compose.yaml`, `apps/backend/test/global-setup.ts`
- Create: `apps/backend/src/platform/mqtt/{mqtt.connection.ts, mqtt.health.ts, mqtt.token.ts, mqtt.module.ts, index.ts}`, `apps/backend/test/mqtt.e2e-spec.ts`

**Interfaces:**

- Consumes: `Env`, `ENV` (Task 2); `DependencyStatus`.
- Produces: Klasse `MqttConnection(settings: MqttSettings)` mit `isConnected(): boolean`, `waitUntilConnected(timeoutMs: number): Promise<boolean>`, `close(): Promise<void>`; `MqttSettings = { url; username; password; clientId; onError?: (error: Error) => void }`; Klasse `MqttHealth` mit `check(): DependencyStatus`; Token `MQTT_CONNECTION`; `MqttModule` (global). Gemeinsame Broker-Konfiguration unter `infra/broker/` (wird in Task 8 zum Image).

- [ ] **Step 1: Broker-Dateien verschieben, lokale Infrastruktur nachziehen**

```bash
mkdir -p infra/broker
git mv infra/local/mosquitto/mosquitto.conf infra/broker/mosquitto.conf
git mv infra/local/mosquitto/entrypoint.sh infra/broker/entrypoint.sh
```

In `infra/local/compose.yaml` beim Dienst `broker` die zwei Volume-Zeilen ersetzen durch:

```yaml
- ../broker/mosquitto.conf:/mosquitto/config/mosquitto.conf:ro
- ../broker/entrypoint.sh:/smart/entrypoint.sh:ro
```

Run: `docker compose -f infra/local/compose.yaml up -d --wait --force-recreate broker && pnpm infra:test`
Expected: `OK: local infrastructure smoke test passed`.

- [ ] **Step 2: Test-Infrastruktur um einen echten Broker erweitern**

`apps/backend/test/global-setup.ts` vollständig ersetzen:

```ts
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, Wait } from 'testcontainers';
import type { TestProject } from 'vitest/node';

const brokerFile = (name: string): string =>
  fileURLToPath(new URL(`../../../infra/broker/${name}`, import.meta.url));

export const TEST_MQTT_USER = 'smart-api';
export const TEST_MQTT_PASSWORD = 'smart-test';

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const [database, broker] = await Promise.all([
    new PostgreSqlContainer('timescale/timescaledb:2.30.2-pg17')
      .withDatabase('smart')
      .withUsername('smart')
      .withPassword('smart-test')
      // A non-UTC server default proves that our client forces UTC per session.
      .withCommand(['postgres', '-c', 'timezone=Europe/Berlin'])
      .start(),
    new GenericContainer('eclipse-mosquitto:2.1.2-alpine')
      .withCopyFilesToContainer([
        { source: brokerFile('mosquitto.conf'), target: '/mosquitto/config/mosquitto.conf' },
        { source: brokerFile('entrypoint.sh'), target: '/smart/entrypoint.sh' },
      ])
      .withEntrypoint(['/bin/sh', '/smart/entrypoint.sh'])
      .withEnvironment({ MQTT_USER: TEST_MQTT_USER, MQTT_PASSWORD: TEST_MQTT_PASSWORD })
      .withExposedPorts(1883)
      .withWaitStrategy(Wait.forLogMessage(/running/))
      .start(),
  ]);

  project.provide('testEnv', {
    DATABASE_URL: database.getConnectionUri(),
    MQTT_URL: `mqtt://${broker.getHost()}:${broker.getMappedPort(1883)}`,
    MQTT_USERNAME: TEST_MQTT_USER,
    MQTT_PASSWORD: TEST_MQTT_PASSWORD,
  });

  return async () => {
    await Promise.all([broker.stop(), database.stop()]);
  };
}

declare module 'vitest' {
  export interface ProvidedContext {
    testEnv: Record<'DATABASE_URL' | 'MQTT_URL' | 'MQTT_USERNAME' | 'MQTT_PASSWORD', string>;
  }
}
```

- [ ] **Step 3: Failing tests**

`apps/backend/test/mqtt.e2e-spec.ts`:

```ts
import { inject } from 'vitest';
import { MqttConnection, MqttHealth } from '../src/platform/mqtt/index.js';

const env = inject('testEnv');

function connect(password: string, errors: Error[] = []): MqttConnection {
  return new MqttConnection({
    url: env.MQTT_URL,
    username: env.MQTT_USERNAME,
    password,
    clientId: `test-${Math.random().toString(16).slice(2)}`,
    onError: (error) => errors.push(error),
  });
}

describe('MqttConnection', () => {
  it('connects with valid credentials and reports up', async () => {
    const connection = connect(env.MQTT_PASSWORD);
    try {
      expect(await connection.waitUntilConnected(5000)).toBe(true);
      expect(new MqttHealth(connection).check()).toBe('up');
    } finally {
      await connection.close();
    }
  });

  it('stays down with a wrong password and reports the error instead of crashing', async () => {
    const errors: Error[] = [];
    const connection = connect('wrong-password', errors);
    try {
      expect(await connection.waitUntilConnected(3000)).toBe(false);
      expect(new MqttHealth(connection).check()).toBe('down');
      expect(errors.length).toBeGreaterThan(0);
    } finally {
      await connection.close();
    }
  });
});
```

- [ ] **Step 4: Test laufen lassen – muss fehlschlagen**

Run: `pnpm --filter @smart/backend exec vitest run --config vitest.config.e2e.ts test/mqtt.e2e-spec.ts`
Expected: FAIL – `Cannot find module '../src/platform/mqtt/index.js'`.

- [ ] **Step 5: Implementierung**

```bash
pnpm --filter @smart/backend add --save-exact mqtt@5.16.0
```

`apps/backend/src/platform/mqtt/mqtt.connection.ts`:

```ts
import { connect, type MqttClient } from 'mqtt';

export interface MqttSettings {
  url: string;
  username: string;
  password: string;
  clientId: string;
  onError?: (error: Error) => void;
}

/** Long-lived broker connection with automatic reconnect; errors never crash the process. */
export class MqttConnection {
  private readonly client: MqttClient;

  constructor(settings: MqttSettings) {
    this.client = connect(settings.url, {
      username: settings.username,
      password: settings.password,
      clientId: settings.clientId,
      clean: true,
      connectTimeout: 5000,
      reconnectPeriod: 2000,
    });
    this.client.on('error', (error) => settings.onError?.(error));
  }

  isConnected(): boolean {
    return this.client.connected;
  }

  waitUntilConnected(timeoutMs: number): Promise<boolean> {
    if (this.client.connected) return Promise.resolve(true);
    return new Promise((resolve) => {
      const onConnect = (): void => {
        clearTimeout(timer);
        resolve(true);
      };
      const timer = setTimeout(() => {
        this.client.off('connect', onConnect);
        resolve(false);
      }, timeoutMs);
      this.client.once('connect', onConnect);
    });
  }

  async close(): Promise<void> {
    await this.client.endAsync(true);
  }
}
```

`apps/backend/src/platform/mqtt/mqtt.token.ts`:

```ts
export const MQTT_CONNECTION = Symbol('MQTT_CONNECTION');
```

`apps/backend/src/platform/mqtt/mqtt.health.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import type { DependencyStatus } from '@smart/contracts';
import { MqttConnection } from './mqtt.connection.js';
import { MQTT_CONNECTION } from './mqtt.token.js';

@Injectable()
export class MqttHealth {
  constructor(@Inject(MQTT_CONNECTION) private readonly connection: MqttConnection) {}

  check(): DependencyStatus {
    return this.connection.isConnected() ? 'up' : 'down';
  }
}
```

`apps/backend/src/platform/mqtt/mqtt.module.ts`:

```ts
import { randomUUID } from 'node:crypto';
import {
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ENV, type Env } from '../config/index.js';
import { MqttConnection } from './mqtt.connection.js';
import { MqttHealth } from './mqtt.health.js';
import { MQTT_CONNECTION } from './mqtt.token.js';

@Injectable()
class MqttLifecycle implements OnApplicationShutdown {
  constructor(@Inject(MQTT_CONNECTION) private readonly connection: MqttConnection) {}

  async onApplicationShutdown(): Promise<void> {
    await this.connection.close();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: MQTT_CONNECTION,
      inject: [ENV],
      useFactory: (env: Env): MqttConnection => {
        const logger = new Logger('Mqtt');
        return new MqttConnection({
          url: env.MQTT_URL,
          username: env.MQTT_USERNAME,
          password: env.MQTT_PASSWORD,
          clientId: `smart-api-${randomUUID().slice(0, 8)}`,
          onError: (error) => logger.warn(`broker connection error: ${error.message}`),
        });
      },
    },
    MqttHealth,
    MqttLifecycle,
  ],
  exports: [MQTT_CONNECTION, MqttHealth],
})
export class MqttModule {}
```

`apps/backend/src/platform/mqtt/index.ts`:

```ts
export { MqttConnection, type MqttSettings } from './mqtt.connection.js';
export { MqttHealth } from './mqtt.health.js';
export { MqttModule } from './mqtt.module.js';
export { MQTT_CONNECTION } from './mqtt.token.js';
```

- [ ] **Step 6: Tests laufen lassen – müssen bestehen**

Run: `pnpm --filter @smart/backend exec vitest run --config vitest.config.e2e.ts`
Expected: PASS – Datenbank- (5), MQTT- (2) und Health-Tests (2).

- [ ] **Step 7: Commit**

```bash
pnpm format && pnpm lint
git add infra apps/backend pnpm-lock.yaml
git commit -m "feat(backend): add MQTT platform and share broker config"
```

---

### Task 5: Logging, Readiness und Verdrahtung der App

**Files:**

- Create: `apps/backend/src/platform/observability/{readiness.service.ts, http-logger.options.ts, http-logger.options.spec.ts, logging.module.ts}`
- Modify: `apps/backend/src/platform/observability/{health.controller.ts, observability.module.ts, index.ts}`, `apps/backend/src/app.module.ts`, `apps/backend/src/main.ts`, `apps/backend/test/health.e2e-spec.ts`

**Interfaces:**

- Consumes: `DatabaseHealth`, `MqttHealth`, `ConfigModule`, `DatabaseModule`, `MqttModule`, `ENV`, `HealthReadyResponse`.
- Produces: `GET /api/health/ready` → `200 HealthReadyResponse` bzw. `503` mit gleichem Body; Response-Header `x-trace-id` (UUID) auf jeder Antwort; `createHttpLoggerOptions(level: string): Options` (pino-http); `ReadinessService.check(): Promise<HealthReadyResponse>`.

- [ ] **Step 1: Failing tests**

`apps/backend/src/platform/observability/http-logger.options.spec.ts`:

```ts
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Writable } from 'node:stream';
import { pinoHttp } from 'pino-http';
import { afterEach, describe, expect, it } from 'vitest';
import { createHttpLoggerOptions } from './http-logger.options.js';

let server: Server | undefined;
afterEach(() => server?.close());

async function serve(): Promise<{ url: string; lines: () => Record<string, unknown>[] }> {
  const chunks: string[] = [];
  const sink = new Writable({
    write(chunk, _encoding, done) {
      chunks.push(String(chunk));
      done();
    },
  });
  const logger = pinoHttp(createHttpLoggerOptions('info'), sink);
  server = createServer((req, res) => {
    logger(req, res);
    res.setHeader('set-cookie', 'session=server-secret');
    res.end('ok');
  });
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    lines: () =>
      chunks
        .join('')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l)),
  };
}

describe('createHttpLoggerOptions', () => {
  it('redacts cookies and authorization and tags every request with a traceId', async () => {
    const { url, lines } = await serve();
    const response = await fetch(`${url}/api/things`, {
      headers: { cookie: 'session=client-secret', authorization: 'Bearer token-secret' },
    });
    const traceId = response.headers.get('x-trace-id');

    const raw = JSON.stringify(lines());
    expect(traceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(raw).toContain(traceId);
    expect(raw).not.toContain('client-secret');
    expect(raw).not.toContain('token-secret');
    expect(raw).not.toContain('server-secret');
  });

  it('does not log health probes', async () => {
    const { url, lines } = await serve();
    await fetch(`${url}/api/health/live`);
    expect(lines()).toEqual([]);
  });
});
```

`apps/backend/test/health.e2e-spec.ts` vollständig ersetzen:

```ts
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { healthLiveResponseSchema, healthReadyResponseSchema } from '@smart/contracts';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { inject } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { MQTT_CONNECTION, type MqttConnection } from '../src/platform/mqtt/index.js';

async function startApp(): Promise<INestApplication<App>> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<INestApplication<App>>();
  configureApp(app);
  await app.init();
  await app.get<MqttConnection>(MQTT_CONNECTION).waitUntilConnected(5000);
  return app;
}

describe('health endpoints with all dependencies up', () => {
  let app: INestApplication<App>;
  beforeAll(async () => {
    app = await startApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('GET /api/health/live reports the process as live and sets a trace id', async () => {
    const response = await request(app.getHttpServer()).get('/api/health/live').expect(200);
    expect(healthLiveResponseSchema.parse(response.body)).toEqual({ status: 'ok' });
    expect(response.headers['x-trace-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('GET /api/health/ready reports database and broker up', async () => {
    const response = await request(app.getHttpServer()).get('/api/health/ready').expect(200);
    expect(healthReadyResponseSchema.parse(response.body)).toEqual({
      status: 'ok',
      checks: { database: 'up', broker: 'up' },
    });
  });

  it('serves nothing outside the /api prefix', async () => {
    await request(app.getHttpServer()).get('/health/live').expect(404);
  });
});

describe('health endpoints with the database down', () => {
  let app: INestApplication<App>;
  const original = inject('testEnv').DATABASE_URL;
  beforeAll(async () => {
    process.env.DATABASE_URL = 'postgres://smart:x@127.0.0.1:1/smart';
    app = await startApp();
  });
  afterAll(async () => {
    await app.close();
    process.env.DATABASE_URL = original;
  });

  it('GET /api/health/ready answers 503 and names the failing dependency', async () => {
    const response = await request(app.getHttpServer()).get('/api/health/ready').expect(503);
    expect(healthReadyResponseSchema.parse(response.body)).toEqual({
      status: 'unavailable',
      checks: { database: 'down', broker: 'up' },
    });
  });

  it('GET /api/health/live stays 200 (liveness does not depend on the database)', async () => {
    await request(app.getHttpServer()).get('/api/health/live').expect(200);
  });
});
```

- [ ] **Step 2: Tests laufen lassen – müssen fehlschlagen**

Run: `pnpm --filter @smart/backend test`
Expected: FAIL – `Cannot find module './http-logger.options.js'`; e2e: `/api/health/ready` 404, `x-trace-id` fehlt.

- [ ] **Step 3: Implementierung**

```bash
pnpm --filter @smart/backend add --save-exact nestjs-pino@5.3.1 pino@10.4.0 pino-http@11.0.0
```

`apps/backend/src/platform/observability/http-logger.options.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { Options } from 'pino-http';

/** One JSON line per request; secrets redacted; health probes are not logged. */
export function createHttpLoggerOptions(level: string): Options {
  return {
    level,
    genReqId: (_req, res) => {
      const traceId = randomUUID();
      res.setHeader('x-trace-id', traceId);
      return traceId;
    },
    customAttributeKeys: { reqId: 'traceId' },
    redact: {
      paths: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
      censor: '[redacted]',
    },
    autoLogging: { ignore: (req) => (req.url ?? '').startsWith('/api/health/') },
    timestamp: () => `,"time":"${new Date().toISOString()}"`,
  };
}
```

`apps/backend/src/platform/observability/logging.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { ENV, type Env } from '../config/index.js';
import { createHttpLoggerOptions } from './http-logger.options.js';

@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({ pinoHttp: createHttpLoggerOptions(env.LOG_LEVEL) }),
    }),
  ],
})
export class LoggingModule {}
```

`apps/backend/src/platform/observability/readiness.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import type { HealthReadyResponse } from '@smart/contracts';
import { DatabaseHealth } from '../database/index.js';
import { MqttHealth } from '../mqtt/index.js';

@Injectable()
export class ReadinessService {
  constructor(
    private readonly database: DatabaseHealth,
    private readonly broker: MqttHealth,
  ) {}

  async check(): Promise<HealthReadyResponse> {
    const database = await this.database.check();
    const broker = this.broker.check();
    const status = database === 'up' && broker === 'up' ? 'ok' : 'unavailable';
    return { status, checks: { database, broker } };
  }
}
```

`apps/backend/src/platform/observability/health.controller.ts` vollständig:

```ts
import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import type { HealthLiveResponse, HealthReadyResponse } from '@smart/contracts';
import { ReadinessService } from './readiness.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly readiness: ReadinessService) {}

  @Get('live')
  live(): HealthLiveResponse {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(): Promise<HealthReadyResponse> {
    const result = await this.readiness.check();
    if (result.status !== 'ok') throw new ServiceUnavailableException(result);
    return result;
  }
}
```

`apps/backend/src/platform/observability/observability.module.ts` vollständig:

```ts
import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { LoggingModule } from './logging.module.js';
import { ReadinessService } from './readiness.service.js';

@Module({
  imports: [LoggingModule],
  controllers: [HealthController],
  providers: [ReadinessService],
})
export class ObservabilityModule {}
```

`apps/backend/src/platform/observability/index.ts` bleibt `export { ObservabilityModule } from './observability.module.js';` und bekommt zusätzlich `export { createHttpLoggerOptions } from './http-logger.options.js';`.

`apps/backend/src/app.module.ts` vollständig:

```ts
import { Module } from '@nestjs/common';
import { ConfigModule } from './platform/config/index.js';
import { DatabaseModule } from './platform/database/index.js';
import { MqttModule } from './platform/mqtt/index.js';
import { ObservabilityModule } from './platform/observability/index.js';

@Module({
  imports: [ConfigModule, DatabaseModule, MqttModule, ObservabilityModule],
})
export class AppModule {}
```

`apps/backend/src/main.ts` vollständig:

```ts
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import { ENV, type Env } from './platform/config/index.js';

const app = await NestFactory.create(AppModule, { bufferLogs: true });
app.useLogger(app.get(Logger));
configureApp(app);
await app.listen(app.get<Env>(ENV).PORT);
```

- [ ] **Step 4: Tests laufen lassen – müssen bestehen**

Run: `pnpm --filter @smart/backend test`
Expected: PASS – Unit (Config 5, Logger 2) und e2e (Datenbank 5, MQTT 2, Health 5).

- [ ] **Step 5: Gesamtsuite und Zeitzonen-Lauf**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:tz`
Expected: alles grün.

- [ ] **Step 6: Commit**

```bash
pnpm format
git add apps/backend pnpm-lock.yaml
git commit -m "feat(backend): add readiness check, structured logging and app wiring"
```

---

### Task 6: API-Image

**Files:**

- Create: `apps/backend/Dockerfile`, `.dockerignore`

**Interfaces:**

- Produces: Image `smart-home-api` – Port 3000, User `node`, Befehle `node dist/main.js` (Standard) und `node dist/migrate.js`; benötigt die Env-Variablen aus `Env`.

- [ ] **Step 1: Failing check – Image existiert nicht**

Run: `docker build -f apps/backend/Dockerfile -t smart-home-api:local .`
Expected: FAIL – `failed to read dockerfile`.

- [ ] **Step 2: `.dockerignore`**

```
**/node_modules
**/dist
**/coverage
**/.angular
.git
.github
.local
.superpowers
CLAUDE.local.md
**/.env
**/.env.*
!**/.env.example
tests/e2e/test-results
tests/e2e/playwright-report
```

- [ ] **Step 3: `apps/backend/Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1
FROM node:24.21.0-alpine3.24 AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile --ignore-scripts --filter "@smart/backend..." \
 && pnpm --filter @smart/contracts build \
 && pnpm --filter @smart/backend build \
 && pnpm --filter @smart/backend deploy --prod /out

FROM node:24.21.0-alpine3.24
ENV NODE_ENV=production TZ=UTC
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health/live').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
CMD ["node", "dist/main.js"]
```

Bricht `pnpm … deploy` mit einem Hinweis auf `inject-workspace-packages` ab, im Dockerfile `deploy --prod /out` durch `deploy --prod --legacy /out` ersetzen.

- [ ] **Step 4: Image bauen und gegen die lokale Infrastruktur prüfen**

```bash
docker build -f apps/backend/Dockerfile -t smart-home-api:local .
pnpm infra:up
API_ENV="-e DATABASE_URL=postgres://smart:smart-local-only@db:5432/smart -e MQTT_URL=mqtt://broker:1883 -e MQTT_USERNAME=smart-dev -e MQTT_PASSWORD=smart-dev-only"
docker run --rm --network smart-local_default $API_ENV smart-home-api:local node dist/migrate.js
docker run -d --name smart-api-check --network smart-local_default $API_ENV -p 127.0.0.1:13000:3000 --read-only --tmpfs /tmp smart-home-api:local
until [ "$(docker inspect -f '{{.State.Health.Status}}' smart-api-check)" = healthy ]; do sleep 2; done
curl -s 127.0.0.1:13000/api/health/ready; echo
docker exec smart-api-check id -u
docker rm -f smart-api-check
```

Expected: `migrations applied`; Container wird `healthy`; `{"status":"ok","checks":{"database":"up","broker":"up"}}`; `id -u` gibt `1000` aus.

Hinweis zur Ausführung: Bash-Aufrufe von Claude Code dürfen kein Vordergrund-`sleep` nutzen; die Warteschleife als Monitor-/until-Konstrukt ausführen oder `docker run` mit `--health-*` und `docker wait`-Äquivalent prüfen.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/Dockerfile .dockerignore
git commit -m "feat(backend): add production container image"
```

---

### Task 7: Web-Image mit Security-Headern und CSP-Nonce

**Files:**

- Create: `apps/frontend/Dockerfile`, `apps/frontend/nginx/default.conf`, `apps/frontend/nginx/security-headers.conf`
- Modify: `apps/frontend/src/index.html`, `apps/frontend/angular.json`

**Interfaces:**

- Produces: Image `smart-home-web` – Port 8080, User `nginx` (101), `/healthz` → `200 ok`, `/api/*` → `http://api:3000` (Docker-DNS, lazy aufgelöst), SPA-Fallback auf `/index.html`, CSP-Nonce pro Antwort (`$request_id`) im Header und im Attribut `ngCspNonce`.

- [ ] **Step 1: Failing check**

Run: `docker build -f apps/frontend/Dockerfile -t smart-home-web:local .`
Expected: FAIL – `failed to read dockerfile`.

- [ ] **Step 2: Angular für CSP vorbereiten**

In `apps/frontend/src/index.html`: `<title>` auf `Smart Home` setzen und `<app-root></app-root>` ersetzen durch `<app-root ngCspNonce="CSP_NONCE"></app-root>`.

In `apps/frontend/angular.json` unter `projects.frontend.architect.build.configurations.production` ergänzen:

```json
"optimization": {
  "scripts": true,
  "styles": { "minify": true, "inlineCritical": false },
  "fonts": true
}
```

(Critical-CSS-Inlining erzeugt `onload`-Handler, die unter einer strikten CSP blockiert würden.)

- [ ] **Step 3: nginx-Konfiguration**

`apps/frontend/nginx/security-headers.conf`:

```nginx
# Included in every location that sets its own headers (nginx drops inherited add_header otherwise).
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'nonce-$request_id'; img-src 'self' data:; font-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()" always;
add_header Cross-Origin-Opener-Policy "same-origin" always;
add_header X-Frame-Options "DENY" always;
```

`apps/frontend/nginx/default.conf`:

```nginx
server {
  listen 8080;
  server_name _;
  root /usr/share/nginx/html;
  server_tokens off;

  # Docker's embedded DNS; resolving lazily lets nginx start before the api container.
  resolver 127.0.0.11 valid=10s ipv6=off;

  gzip on;
  gzip_types text/css application/javascript application/json image/svg+xml;

  location = /healthz {
    access_log off;
    default_type text/plain;
    return 200 'ok';
  }

  location /api/ {
    set $api_upstream http://api:3000;
    proxy_pass $api_upstream;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;
    proxy_buffering off;
    proxy_read_timeout 1h;
    include /etc/nginx/snippets/security-headers.conf;
  }

  location ~* \.(?:js|css)$ {
    try_files $uri =404;
    add_header Cache-Control "public, max-age=31536000, immutable" always;
    include /etc/nginx/snippets/security-headers.conf;
  }

  location / {
    try_files $uri $uri/ /index.html;
    add_header Cache-Control "no-cache" always;
    sub_filter_once off;
    sub_filter_types text/html;
    sub_filter 'CSP_NONCE' $request_id;
    include /etc/nginx/snippets/security-headers.conf;
  }
}
```

- [ ] **Step 4: `apps/frontend/Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1
FROM node:24.21.0-alpine3.24 AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile --ignore-scripts --filter "@smart/frontend..." \
 && pnpm --filter @smart/contracts build \
 && pnpm --filter @smart/frontend build

FROM nginxinc/nginx-unprivileged:1.31.6-alpine3.24
COPY apps/frontend/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY apps/frontend/nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /repo/apps/frontend/dist/frontend/browser /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
```

Scheitert der Angular-Build, weil durch `--ignore-scripts` ein natives Binary fehlt (Fehlermeldung nennt `esbuild`, `lmdb` oder `@parcel/watcher`), `--ignore-scripts` entfernen und vor dem Install `ENV LEFTHOOK=0` setzen sowie `git init -q` ausführen (damit der `prepare`-Hook von lefthook nicht scheitert).

- [ ] **Step 5: Image bauen und prüfen**

```bash
docker build -f apps/frontend/Dockerfile -t smart-home-web:local .
docker run -d --name smart-web-check -p 127.0.0.1:18081:8080 --read-only --tmpfs /tmp smart-home-web:local
curl -s 127.0.0.1:18081/healthz; echo
curl -sI 127.0.0.1:18081/ | grep -iE "content-security-policy|x-content-type|cache-control"
curl -s 127.0.0.1:18081/ | grep -o 'ngcspnonce="[^"]*"'
curl -s -o /dev/null -w '%{http_code}\n' 127.0.0.1:18081/devices/123
docker exec smart-web-check id -u
docker rm -f smart-web-check
```

Expected: `ok`; CSP-Header mit `'nonce-<32 hex>'`, `nosniff`, `no-cache`; im HTML `ngcspnonce="<derselbe 32-hex-Wert>"` (Groß-/Kleinschreibung des Attributs egal); Deep-Link `200`; `id -u` = `101`. (`/api` liefert hier 502, weil kein api-Container läuft – erwartet.)

- [ ] **Step 6: Frontend-Suite**

Run: `pnpm --filter @smart/frontend test && pnpm --filter @smart/frontend build && pnpm lint`
Expected: grün.

- [ ] **Step 7: Commit**

```bash
pnpm format
git add apps/frontend
git commit -m "feat(frontend): add nginx image with CSP nonce and security headers"
```

---

### Task 8: Broker- und Backup-Images

**Files:**

- Create: `infra/broker/Dockerfile`, `infra/backup/{Dockerfile, crontab, backup.sh, restore-test.sh}`

**Interfaces:**

- Produces: Image `smart-home-broker` (Env `MQTT_USER`, `MQTT_PASSWORD`; Daten unter `/mosquitto/data`). Image `smart-home-backup` (Befehle `backup.sh`, `restore-test.sh`; Standard: supercronic mit Crontab). Env des Backup-Containers: `PGHOST`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `RESTIC_REPOSITORY`, `RESTIC_PASSWORD`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `BACKUP_HOST_TAG`, optional `HC_BACKUP_URL`, `HC_RESTORE_URL`, `RESTIC_CACHE_DIR`; Stack-Verzeichnis read-only unter `/stack-config`.

- [ ] **Step 1: Broker-Image**

`infra/broker/Dockerfile`:

```dockerfile
FROM eclipse-mosquitto:2.1.2-alpine
COPY mosquitto.conf /mosquitto/config/mosquitto.conf
COPY entrypoint.sh /smart/entrypoint.sh
ENTRYPOINT ["/bin/sh", "/smart/entrypoint.sh"]
HEALTHCHECK --interval=10s --timeout=5s --retries=10 \
  CMD mosquitto_sub -h localhost -u "$MQTT_USER" -P "$MQTT_PASSWORD" -t '$SYS/broker/uptime' -C 1 -W 3 > /dev/null || exit 1
```

Run:

```bash
docker build -t smart-home-broker:local infra/broker
docker run -d --name smart-broker-check -e MQTT_USER=u -e MQTT_PASSWORD=p smart-home-broker:local
until [ "$(docker inspect -f '{{.State.Health.Status}}' smart-broker-check)" = healthy ]; do sleep 2; done
docker exec smart-broker-check mosquitto_pub -h localhost -t x -m y; echo "anonymous exit=$?"
docker rm -f smart-broker-check
```

Expected: Container wird `healthy`; anonymes Publish scheitert (`anonymous exit=` ≠ 0).

- [ ] **Step 2: Backup-Skripte**

`infra/backup/backup.sh`:

```sh
#!/bin/sh
# Nightly backup: database dump and stack configuration into the restic repository.
set -eu
: "${RESTIC_REPOSITORY:?}" "${RESTIC_PASSWORD:?}" "${BACKUP_HOST_TAG:?}"

ping_hc() {
  [ -n "${HC_BACKUP_URL:-}" ] || return 0
  curl -fsS -m 10 --retry 3 -o /dev/null "${HC_BACKUP_URL}$1" || true
}

ping_hc /start
trap 'ping_hc /fail' EXIT

restic cat config > /dev/null 2>&1 || restic init
restic backup --host "$BACKUP_HOST_TAG" --tag db --stdin-filename smart.dump \
  --stdin-from-command -- pg_dump --format=custom --no-owner
restic backup --host "$BACKUP_HOST_TAG" --tag config --exclude '/stack-config/deploy.env.next' /stack-config
restic forget --host "$BACKUP_HOST_TAG" --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune
restic check

trap - EXIT
ping_hc ""
echo "backup completed"
```

`infra/backup/restore-test.sh`:

```sh
#!/bin/sh
# Monthly restore test: restores the latest dump into a throw-away database and checks it.
set -eu
: "${RESTIC_REPOSITORY:?}" "${RESTIC_PASSWORD:?}" "${BACKUP_HOST_TAG:?}"

ping_hc() {
  [ -n "${HC_RESTORE_URL:-}" ] || return 0
  curl -fsS -m 10 --retry 3 -o /dev/null "${HC_RESTORE_URL}$1" || true
}

ping_hc /start
trap 'ping_hc /fail' EXIT

dump=/tmp/restore-check.dump
restic dump --host "$BACKUP_HOST_TAG" --tag db latest smart.dump > "$dump"

psql -v ON_ERROR_STOP=1 -q -d postgres -c 'DROP DATABASE IF EXISTS restore_check' -c 'CREATE DATABASE restore_check'
psql -v ON_ERROR_STOP=1 -q -d restore_check -c 'CREATE EXTENSION IF NOT EXISTS timescaledb' -c 'SELECT timescaledb_pre_restore()'
# pg_restore reports the already existing timescaledb extension as an error; the checks below decide.
pg_restore --no-owner -d restore_check "$dump" || echo "pg_restore reported errors; verifying content"
psql -v ON_ERROR_STOP=1 -q -d restore_check -c 'SELECT timescaledb_post_restore()'

migrations=$(psql -tA -d restore_check -c 'select count(*) from drizzle.__drizzle_migrations')
[ "$migrations" -ge 1 ] || { echo "restore check failed: no migrations in restored database" >&2; exit 1; }

psql -v ON_ERROR_STOP=1 -q -d postgres -c 'DROP DATABASE restore_check'
rm -f "$dump"

trap - EXIT
ping_hc ""
echo "restore test passed ($migrations migrations)"
```

`infra/backup/crontab`:

```
# Times are UTC (container TZ).
15 3 * * * /usr/local/bin/backup.sh
45 4 1 * * /usr/local/bin/restore-test.sh
```

`infra/backup/Dockerfile`:

```dockerfile
FROM alpine:3.24.2
RUN apk add --no-cache restic postgresql17-client supercronic curl tzdata \
 && adduser -D -u 10001 backup
COPY --chmod=0755 backup.sh restore-test.sh /usr/local/bin/
COPY crontab /etc/smart-backup.crontab
ENV TZ=UTC RESTIC_CACHE_DIR=/tmp/restic-cache
USER backup
CMD ["supercronic", "-passthrough-logs", "/etc/smart-backup.crontab"]
```

- [ ] **Step 3: Failing check – Image existiert noch nicht gebaut**

Run: `docker image inspect smart-home-backup:local > /dev/null 2>&1 && echo exists || echo missing`
Expected: `missing`.

- [ ] **Step 4: Bauen**

Run: `docker build -t smart-home-backup:local infra/backup`
Expected: Build erfolgreich.

- [ ] **Step 5: Backup und Restore-Test gegen die lokale Datenbank**

Voraussetzung: lokale Infrastruktur läuft und Migrationen wurden angewendet (Task 3, Step 8).

```bash
docker volume create smart-backup-test
BACKUP_ENV="-e PGHOST=db -e PGUSER=smart -e PGPASSWORD=smart-local-only -e PGDATABASE=smart -e RESTIC_REPOSITORY=/restic-repo -e RESTIC_PASSWORD=backup-test-only -e BACKUP_HOST_TAG=local"
BACKUP_RUN="docker run --rm --network smart-local_default $BACKUP_ENV -v smart-backup-test:/restic-repo -v $PWD/infra/compose:/stack-config:ro --read-only --tmpfs /tmp smart-home-backup:local"
$BACKUP_RUN backup.sh
$BACKUP_RUN restore-test.sh
```

Expected: `backup completed`; `restore test passed (1 migrations)`.

- [ ] **Step 6: Negativtest – gescheiterter Dump erzeugt keinen Snapshot**

```bash
SNAPSHOTS_BEFORE=$($BACKUP_RUN restic snapshots --tag db --json | grep -o '"id"' | wc -l)
docker run --rm --network smart-local_default $BACKUP_ENV -e PGPASSWORD=wrong -v smart-backup-test:/restic-repo -v $PWD/infra/compose:/stack-config:ro --read-only --tmpfs /tmp smart-home-backup:local backup.sh; echo "exit=$?"
SNAPSHOTS_AFTER=$($BACKUP_RUN restic snapshots --tag db --json | grep -o '"id"' | wc -l)
echo "before=$SNAPSHOTS_BEFORE after=$SNAPSHOTS_AFTER"
docker volume rm smart-backup-test
```

Expected: `exit=` ≠ 0; `before` und `after` gleich.

- [ ] **Step 7: Commit**

```bash
git add infra/broker/Dockerfile infra/backup
git commit -m "feat(infra): add broker and backup images with restore test"
```

---

### Task 9: Produktions-Stack, Browser-Smoke-Test und CI-Job `stack`

**Files:**

- Create: `infra/compose/compose.yaml`, `infra/compose/.env.example`, `infra/compose/test/compose.test.yaml`, `infra/compose/test/stack-test.sh`
- Create: `tests/e2e/package.json`, `tests/e2e/playwright.config.ts`, `tests/e2e/specs/stack-smoke.spec.ts`
- Modify: `pnpm-workspace.yaml`, `.github/workflows/ci.yml`, `.gitignore`

**Interfaces:**

- Consumes: Images aus Task 6–8; `HealthReadyResponse`.
- Produces: Compose-Stack mit Diensten `web`, `api`, `db`, `broker`, `backup` (Profil `backup`); Variablen siehe `.env.example`; Netzwerk-Alias `${STACK_NAME}-web` im Proxy-Netz; CI-Check `stack`.

- [ ] **Step 1: Playwright-Paket und Failing Smoke-Test**

`pnpm-workspace.yaml`: unter `packages` die Zeile `  - tests/*` ergänzen.

`tests/e2e/package.json`:

```json
{
  "name": "@smart/e2e",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "e2e": "playwright test"
  },
  "devDependencies": {
    "@playwright/test": "1.64.0"
  }
}
```

`tests/e2e/playwright.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './specs',
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:18080',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
```

`tests/e2e/specs/stack-smoke.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

test('the app shell loads without console errors or CSP violations', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(error.message));

  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  await expect(page.locator('app-root')).toBeAttached();
  await page.waitForLoadState('networkidle');
  expect(problems).toEqual([]);
});

test('every HTML response carries its own CSP nonce matching the page', async ({ request }) => {
  const nonces: string[] = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await request.get('/');
    const csp = response.headers()['content-security-policy'] ?? '';
    const headerNonce = /'nonce-([0-9a-f]{32})'/.exec(csp)?.[1];
    const bodyNonce = /ngCspNonce="([0-9a-f]{32})"/i.exec(await response.text())?.[1];
    expect(headerNonce).toBeDefined();
    expect(bodyNonce).toBe(headerNonce);
    nonces.push(headerNonce ?? '');
  }
  expect(nonces[0]).not.toBe(nonces[1]);
});

for (const path of ['/', '/devices/123', '/api/health/live']) {
  test(`security headers are present on ${path}`, async ({ request }) => {
    const headers = (await request.get(path)).headers();
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });
}

test('hashed assets are cacheable and keep the security headers', async ({ page, request }) => {
  await page.goto('/');
  const script = await page.locator('script[src]').first().getAttribute('src');
  expect(script).toBeTruthy();
  const headers = (await request.get(script ?? '')).headers();
  expect(headers['cache-control']).toContain('immutable');
  expect(headers['x-content-type-options']).toBe('nosniff');
});

test('deep links fall back to the app shell', async ({ request }) => {
  const response = await request.get('/devices/123');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('text/html');
});

test('the API is reachable through the web container and ready', async ({ request }) => {
  const response = await request.get('/api/health/ready');
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: 'ok', checks: { database: 'up', broker: 'up' } });
});

test('unknown API routes answer 404 instead of the app shell', async ({ request }) => {
  expect((await request.get('/api/does-not-exist')).status()).toBe(404);
});
```

`.gitignore`: Zeilen `tests/e2e/test-results/` und `tests/e2e/playwright-report/` ergänzen.

```bash
pnpm install
pnpm --filter @smart/e2e exec playwright install chromium
pnpm --filter @smart/e2e e2e
```

Expected: FAIL – Verbindungsfehler zu `127.0.0.1:18080` (Stack läuft noch nicht).

- [ ] **Step 2: `infra/compose/compose.yaml`**

```yaml
name: ${STACK_NAME:?STACK_NAME is required}

x-defaults: &defaults
  restart: unless-stopped
  logging:
    driver: json-file
    options:
      max-size: 10m
      max-file: '5'

services:
  web:
    <<: *defaults
    image: ${IMAGE_REGISTRY:-ghcr.io/tkosiol}/smart-home-web:${IMAGE_TAG:?IMAGE_TAG is required}
    read_only: true
    tmpfs: [/tmp]
    depends_on:
      api:
        condition: service_healthy
    networks:
      internal: {}
      proxy:
        aliases: ['${STACK_NAME}-web']

  api:
    <<: *defaults
    image: ${IMAGE_REGISTRY:-ghcr.io/tkosiol}/smart-home-api:${IMAGE_TAG:?IMAGE_TAG is required}
    read_only: true
    tmpfs: [/tmp]
    environment:
      NODE_ENV: production
      LOG_LEVEL: ${LOG_LEVEL:-info}
      TZ: UTC
      DATABASE_URL: postgres://smart:${DB_PASSWORD:?DB_PASSWORD is required}@db:5432/smart
      MQTT_URL: mqtt://broker:1883
      MQTT_USERNAME: smart-api
      MQTT_PASSWORD: ${MQTT_API_PASSWORD:?MQTT_API_PASSWORD is required}
    depends_on:
      db:
        condition: service_healthy
      broker:
        condition: service_healthy
    networks: [internal]

  db:
    <<: *defaults
    image: timescale/timescaledb:2.30.2-pg17
    command: ['postgres', '-c', 'timezone=UTC', '-c', 'log_timezone=UTC']
    shm_size: 256mb
    environment:
      POSTGRES_USER: smart
      POSTGRES_DB: smart
      POSTGRES_PASSWORD: ${DB_PASSWORD:?DB_PASSWORD is required}
      TZ: UTC
    volumes:
      - db-data:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U smart -d smart']
      interval: 5s
      timeout: 3s
      retries: 20
    networks: [internal]

  broker:
    <<: *defaults
    image: ${IMAGE_REGISTRY:-ghcr.io/tkosiol}/smart-home-broker:${IMAGE_TAG:?IMAGE_TAG is required}
    read_only: true
    tmpfs: [/tmp]
    environment:
      MQTT_USER: smart-api
      MQTT_PASSWORD: ${MQTT_API_PASSWORD:?MQTT_API_PASSWORD is required}
      TZ: UTC
    volumes:
      - broker-data:/mosquitto/data
    networks: [internal]

  backup:
    <<: *defaults
    profiles: [backup]
    image: ${IMAGE_REGISTRY:-ghcr.io/tkosiol}/smart-home-backup:${IMAGE_TAG:?IMAGE_TAG is required}
    read_only: true
    tmpfs: [/tmp]
    environment:
      PGHOST: db
      PGUSER: smart
      PGDATABASE: smart
      PGPASSWORD: ${DB_PASSWORD:?DB_PASSWORD is required}
      RESTIC_REPOSITORY: s3:https://${B2_ENDPOINT:-}/${B2_BUCKET:-}
      RESTIC_PASSWORD: ${RESTIC_PASSWORD:-}
      AWS_ACCESS_KEY_ID: ${B2_KEY_ID:-}
      AWS_SECRET_ACCESS_KEY: ${B2_APP_KEY:-}
      BACKUP_HOST_TAG: ${STACK_NAME}
      HC_BACKUP_URL: ${HC_BACKUP_URL:-}
      HC_RESTORE_URL: ${HC_RESTORE_URL:-}
    volumes:
      - ./:/stack-config:ro
    depends_on:
      db:
        condition: service_healthy
    networks: [internal]

networks:
  internal: {}
  proxy:
    external: true
    name: ${PROXY_NETWORK:-proxy-network}

volumes:
  db-data: {}
  broker-data: {}
```

`infra/compose/.env.example`:

```
# Written by infra/deploy/provision.sh on the VPS (~/docker/apps/<stack>/.env, mode 600).
# IMAGE_TAG is not set here: deploy.sh writes it to deploy.env for every release.
STACK_NAME=smart-staging
APP_DOMAIN=staging.smart.tillkosiol.de
DB_PASSWORD=<generated>
MQTT_API_PASSWORD=<generated>

# Production only (enables the backup container):
# COMPOSE_PROFILES=backup
# B2_ENDPOINT=<B2_S3_ENDPOINT>
# B2_BUCKET=<B2_BUCKET>
# B2_KEY_ID=<from password manager>
# B2_APP_KEY=<from password manager>
# RESTIC_PASSWORD=<from password manager>
# HC_BACKUP_URL=<healthchecks.io ping URL>
# HC_RESTORE_URL=<healthchecks.io ping URL>
```

- [ ] **Step 3: Test-Overlay und Stack-Test-Skript**

`infra/compose/test/compose.test.yaml`:

```yaml
services:
  web:
    ports:
      - '127.0.0.1:18080:8080'
  backup:
    environment:
      RESTIC_REPOSITORY: /restic-repo
      RESTIC_PASSWORD: stack-test-only
    volumes:
      - restic-test:/restic-repo

volumes:
  restic-test: {}
```

`infra/compose/test/stack-test.sh`:

```sh
#!/usr/bin/env sh
# Builds all images, starts the production stack locally and verifies it end to end.
set -eu
cd "$(dirname "$0")/../../.."

PROJECT=smart-stacktest
TAG=stacktest
NETWORK=smart-stacktest-proxy
ENV_FILE=$(mktemp)

cat > "$ENV_FILE" <<EOF
STACK_NAME=$PROJECT
IMAGE_REGISTRY=local
IMAGE_TAG=$TAG
PROXY_NETWORK=$NETWORK
COMPOSE_PROFILES=backup
DB_PASSWORD=stack-test-db
MQTT_API_PASSWORD=stack-test-mqtt
EOF

compose() {
  docker compose --env-file "$ENV_FILE" -f infra/compose/compose.yaml -f infra/compose/test/compose.test.yaml "$@"
}

cleanup() {
  compose down -v > /dev/null 2>&1 || true
  docker network rm "$NETWORK" > /dev/null 2>&1 || true
  rm -f "$ENV_FILE"
}
trap cleanup EXIT

docker build -q -f apps/backend/Dockerfile -t "local/smart-home-api:$TAG" .
docker build -q -f apps/frontend/Dockerfile -t "local/smart-home-web:$TAG" .
docker build -q -t "local/smart-home-broker:$TAG" infra/broker
docker build -q -t "local/smart-home-backup:$TAG" infra/backup

docker network inspect "$NETWORK" > /dev/null 2>&1 || docker network create "$NETWORK" > /dev/null

compose up -d --wait db broker
compose run --rm --no-deps api node dist/migrate.js
compose up -d --wait

compose exec -T backup backup.sh
compose exec -T backup restore-test.sh

E2E_BASE_URL=http://127.0.0.1:18080 pnpm --filter @smart/e2e e2e

echo "OK: stack test passed"
```

`chmod +x infra/compose/test/stack-test.sh`

- [ ] **Step 4: Stack-Test ausführen**

Run: `sh infra/compose/test/stack-test.sh`
Expected: `migrations applied`, `backup completed`, `restore test passed (1 migrations)`, alle Playwright-Tests grün, `OK: stack test passed`.

Typische Ursachen bei Rot (im Code beheben, nicht im Test): Dienst `backup` unbekannt → Compose liest `COMPOSE_PROFILES` nicht aus der `--env-file`-Datei; dann in `stack-test.sh` und `deploy.sh` vor den Compose-Aufrufen `set -a; . <env-datei>; set +a` ausführen und das als Ruling festhalten. Container mit `read_only` braucht ein zusätzliches beschreibbares Verzeichnis (Fehlermeldung „Read-only file system“ → passenden `tmpfs`-Pfad ergänzen); Konsolenfehler mit „Refused to apply inline style“ → Angular-Build-Option oder CSP prüfen.

- [ ] **Step 5: CI-Job `stack`**

In `.github/workflows/ci.yml` unter `jobs:` ergänzen:

```yaml
stack:
  name: stack
  runs-on: ubuntu-24.04
  env:
    LEFTHOOK: '0'
  steps:
    - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      with:
        persist-credentials: false
    - uses: pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413 # v6.1.0
    - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
      with:
        node-version-file: .nvmrc
        cache: pnpm
    - run: pnpm install --frozen-lockfile
    - run: pnpm --filter @smart/e2e exec playwright install --with-deps chromium
    - run: sh infra/compose/test/stack-test.sh
```

Run: `docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:latest -color`
Expected: keine Ausgabe.

- [ ] **Step 6: Commit**

```bash
pnpm format && pnpm lint
git add infra/compose tests pnpm-workspace.yaml pnpm-lock.yaml .github/workflows/ci.yml .gitignore
git commit -m "feat(infra): add production compose stack with end-to-end stack test"
```

---

### Task 10: Deploy- und Provisionierungs-Skripte mit Tests, CI-Job `ops`

**Files:**

- Create: `infra/deploy/smart-deploy`, `infra/deploy/deploy.sh`, `infra/deploy/provision.sh`
- Create: `infra/deploy/test/run-tests.sh`, `infra/deploy/test/stubs/docker`, `infra/deploy/test/stubs/curl`, `infra/deploy/test/stubs/ssh`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**

- Produces:
  - `smart-deploy <environment>` (Forced Command): liest `SSH_ORIGINAL_COMMAND` = `deploy <40-hex-sha>`; Exit 2 bei falscher Eingabe, 3 wenn der Commit nicht auf `main` liegt; Umgebungs-Overrides für Tests: `SMART_DEPLOY_GITHUB_API`, `SMART_DEPLOY_GITHUB_RAW`.
  - `deploy.sh <environment> <sha> <source-dir>`: Stack-Verzeichnis `${SMART_STACKS_DIR:-$HOME/docker/apps}/smart-staging|smart-prod`; schreibt `deploy.env` (`IMAGE_TAG=<sha>`) erst nach Erfolg; Rollback auf vorherige `deploy.env`.
  - `provision.sh <staging|production> [--force]`: benötigt `SMART_VPS=<user@host>`; schreibt `~/docker/apps/<stack>/.env` mit `umask 077`.
  - CI-Check `ops`.

- [ ] **Step 1: Failing tests**

`infra/deploy/test/stubs/docker`:

```sh
#!/bin/sh
# Test double: records every call; fails or answers depending on STUB_* variables.
printf '%s\n' "$*" >> "$STUB_CALLS"
case "$*" in
  *"run --rm --no-deps api node dist/migrate.js"*)
    [ "${STUB_FAIL_MIGRATE:-0}" = 1 ] && exit 1 ;;
  *"deploy.env.next up -d --wait --remove-orphans"*)
    [ "${STUB_FAIL_UP:-0}" = 1 ] && exit 1 ;;
  *"exec -T web wget"*)
    if [ "${STUB_FAIL_READY:-0}" = 1 ]; then echo '{"status":"unavailable"}'; else echo '{"status":"ok"}'; fi ;;
esac
exit 0
```

`infra/deploy/test/stubs/curl`:

```sh
#!/bin/sh
# Test double for curl: GitHub compare API and raw file downloads.
printf 'curl %s\n' "$*" >> "$STUB_CALLS"
out=""
url=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done
case "$url" in
  */compare/*)
    printf '{\n  "url": "x",\n  "status": "%s",\n  "files": [\n    {\n      "status": "modified"\n    }\n  ]\n}\n' "${STUB_COMPARE_STATUS:-behind}" ;;
  */infra/deploy/deploy.sh)
    printf '#!/bin/sh\necho "fake deploy $*" >> "%s"\n' "$STUB_CALLS" > "$out" ;;
  */infra/compose/compose.yaml)
    echo "name: fake" > "$out" ;;
  *) exit 22 ;;
esac
```

`infra/deploy/test/stubs/ssh`:

```sh
#!/bin/sh
# Test double for ssh: "test -e" answers from STUB_ENV_EXISTS; other commands write stdin to STUB_REMOTE_FILE.
printf 'ssh %s\n' "$*" >> "$STUB_CALLS"
case "$*" in
  *"test -e"*) [ "${STUB_ENV_EXISTS:-0}" = 1 ] && exit 0 || exit 1 ;;
  *) cat > "$STUB_REMOTE_FILE" ;;
esac
```

`infra/deploy/test/run-tests.sh`:

```sh
#!/usr/bin/env bash
# Tests for the deploy wrapper, deploy.sh and provision.sh using stubbed docker, curl and ssh.
set -u
cd "$(dirname "$0")/.."
DEPLOY_DIR=$(pwd)
STUBS="$DEPLOY_DIR/test/stubs"
SHA=0123456789abcdef0123456789abcdef01234567
OLD_SHA=89abcdef0123456789abcdef0123456789abcdef
failures=0
passed=0

setup() {
  WORK=$(mktemp -d)
  export STUB_CALLS="$WORK/calls" STUB_REMOTE_FILE="$WORK/remote-env"
  export SMART_STACKS_DIR="$WORK/apps"
  export PATH="$STUBS:$PATH"
  : > "$STUB_CALLS"
  unset STUB_FAIL_MIGRATE STUB_FAIL_UP STUB_FAIL_READY STUB_COMPARE_STATUS STUB_ENV_EXISTS SSH_ORIGINAL_COMMAND
}
teardown() { rm -rf "$WORK"; }
check() {
  if eval "$2"; then passed=$((passed + 1)); else echo "FAIL: $1"; failures=$((failures + 1)); fi
}
run_wrapper() { (sh "$DEPLOY_DIR/smart-deploy" "$@" > "$WORK/out" 2>&1); echo $?; }
prepare_stack() {
  mkdir -p "$SMART_STACKS_DIR/$1"
  echo "STACK_NAME=$1" > "$SMART_STACKS_DIR/$1/.env"
  [ -n "${2:-}" ] && echo "IMAGE_TAG=$2" > "$SMART_STACKS_DIR/$1/deploy.env"
  mkdir -p "$WORK/src" && echo "name: x" > "$WORK/src/compose.yaml"
}
run_deploy() { (sh "$DEPLOY_DIR/deploy.sh" "$1" "$SHA" "$WORK/src" > "$WORK/out" 2>&1); echo $?; }

# --- smart-deploy (wrapper) ---
setup; check "wrapper rejects an unknown environment" '[ "$(SSH_ORIGINAL_COMMAND="deploy $SHA" run_wrapper prod)" = 2 ]'; teardown
setup; check "wrapper rejects a missing command" '[ "$(run_wrapper staging)" = 2 ]'; teardown
setup; check "wrapper rejects a short sha" '[ "$(SSH_ORIGINAL_COMMAND="deploy abc123" run_wrapper staging)" = 2 ]'; teardown
setup; check "wrapper rejects extra arguments" '[ "$(SSH_ORIGINAL_COMMAND="deploy $SHA; touch /tmp/pwned" run_wrapper staging)" = 2 ]'; teardown
setup; mkdir "$WORK/glob" && touch "$WORK/glob/$SHA"
# Without set -f, "deploy *" would expand to "deploy <sha>" here and be accepted.
check "wrapper does not expand globs" '[ "$(cd "$WORK/glob" && SSH_ORIGINAL_COMMAND="deploy *" run_wrapper staging)" = 2 ]'; teardown
setup; check "wrapper rejects other commands" '[ "$(SSH_ORIGINAL_COMMAND="ls -la" run_wrapper staging)" = 2 ]'; teardown
setup; export STUB_COMPARE_STATUS=diverged
check "wrapper refuses commits not on main" '[ "$(SSH_ORIGINAL_COMMAND="deploy $SHA" run_wrapper staging)" = 3 ]'
check "wrapper fetches nothing for commits not on main" '! grep -q "raw" "$STUB_CALLS"'
check "wrapper never calls docker for commits not on main" '! grep -qv "^curl" "$STUB_CALLS"'; teardown
setup; export STUB_COMPARE_STATUS=ahead
check "wrapper refuses commits ahead of main" '[ "$(SSH_ORIGINAL_COMMAND="deploy $SHA" run_wrapper staging)" = 3 ]'; teardown
setup; export STUB_COMPARE_STATUS=behind
check "wrapper runs the commit's deploy.sh for commits on main" '[ "$(SSH_ORIGINAL_COMMAND="deploy $SHA" run_wrapper production)" = 0 ]'
check "wrapper passes environment and sha" 'grep -q "fake deploy production $SHA" "$STUB_CALLS"'
check "wrapper downloads files of exactly that commit" 'grep -q "/$SHA/infra/deploy/deploy.sh" "$STUB_CALLS" && grep -q "/$SHA/infra/compose/compose.yaml" "$STUB_CALLS"'; teardown

# --- deploy.sh ---
setup; check "deploy refuses an unprovisioned stack" '[ "$(run_deploy staging)" = 1 ]'
check "deploy makes no docker calls without .env" '[ ! -s "$STUB_CALLS" ]'; teardown
setup; prepare_stack smart-prod "$OLD_SHA"
check "deploy succeeds on the happy path" '[ "$(run_deploy production)" = 0 ]'
check "deploy runs pull, migrate, up and readiness in order" '[ "$(grep -oE "pull|up -d --wait db broker|dist/migrate.js|up -d --wait --remove-orphans|exec -T web" "$STUB_CALLS" | tr "\n" " ")" = "pull up -d --wait db broker dist/migrate.js up -d --wait --remove-orphans exec -T web " ]'
check "deploy records the new sha" 'grep -qx "IMAGE_TAG=$SHA" "$SMART_STACKS_DIR/smart-prod/deploy.env"'
check "deploy copies the commit compose file" '[ -f "$SMART_STACKS_DIR/smart-prod/compose.yaml" ]'; teardown
setup; prepare_stack smart-prod "$OLD_SHA"; export STUB_FAIL_MIGRATE=1
check "deploy stops when migrations fail" '[ "$(run_deploy production)" = 1 ]'
check "deploy never replaces containers after a failed migration" '! grep -q "remove-orphans" "$STUB_CALLS"'
check "deploy keeps the previous sha after a failed migration" 'grep -qx "IMAGE_TAG=$OLD_SHA" "$SMART_STACKS_DIR/smart-prod/deploy.env"'; teardown
setup; prepare_stack smart-prod "$OLD_SHA"; export STUB_FAIL_UP=1
check "deploy fails when the new version is unhealthy" '[ "$(run_deploy production)" = 1 ]'
check "deploy rolls back to the previous version" 'grep -q "env-file deploy.env up -d --wait --remove-orphans" "$STUB_CALLS"'
check "deploy keeps the previous sha after rollback" 'grep -qx "IMAGE_TAG=$OLD_SHA" "$SMART_STACKS_DIR/smart-prod/deploy.env"'; teardown
setup; prepare_stack smart-staging "$OLD_SHA"; export STUB_FAIL_READY=1
check "deploy fails when readiness fails" '[ "$(run_deploy staging)" = 1 ]'
check "deploy rolls back when readiness fails" 'grep -q "env-file deploy.env up -d --wait --remove-orphans" "$STUB_CALLS"'; teardown

# --- provision.sh ---
answers() { printf 'b2-endpoint\nb2-bucket\nb2-key-id\nb2-app-key\nrestic-pw\nhttps://hc/backup\nhttps://hc/restore\n'; }
setup; export SMART_VPS=deploy@vps
check "provision refuses to overwrite an existing .env" '[ "$(STUB_ENV_EXISTS=1 bash "$DEPLOY_DIR/provision.sh" staging < /dev/null > /dev/null 2>&1; echo $?)" = 1 ]'
check "provision writes staging without backup settings" 'bash "$DEPLOY_DIR/provision.sh" staging < /dev/null > /dev/null 2>&1 && grep -qx "STACK_NAME=smart-staging" "$STUB_REMOTE_FILE" && ! grep -q "B2_" "$STUB_REMOTE_FILE"'
check "provision generates long random passwords" 'grep -Eq "^DB_PASSWORD=[0-9a-f]{64}$" "$STUB_REMOTE_FILE" && grep -Eq "^MQTT_API_PASSWORD=[0-9a-f]{64}$" "$STUB_REMOTE_FILE"'
check "provision writes the file with umask 077" 'grep -q "umask 077" "$STUB_CALLS"'
check "provision writes production with backup settings" 'answers | bash "$DEPLOY_DIR/provision.sh" production > /dev/null 2>&1 && grep -qx "COMPOSE_PROFILES=backup" "$STUB_REMOTE_FILE" && grep -qx "B2_APP_KEY=b2-app-key" "$STUB_REMOTE_FILE" && grep -qx "HC_RESTORE_URL=https://hc/restore" "$STUB_REMOTE_FILE"'
check "provision never prints secrets" '! answers | bash "$DEPLOY_DIR/provision.sh" production 2>&1 | grep -qE "b2-app-key|restic-pw"'; teardown

echo "deploy tests: $passed passed, $failures failed"
[ "$failures" -eq 0 ]
```

`chmod +x infra/deploy/test/run-tests.sh infra/deploy/test/stubs/*`

Run: `bash infra/deploy/test/run-tests.sh`
Expected: FAIL – viele Fehlschläge (`smart-deploy`, `deploy.sh`, `provision.sh` existieren noch nicht), letzte Zeile `deploy tests: N passed, M failed` mit M > 0.

- [ ] **Step 2: `infra/deploy/smart-deploy`**

```sh
#!/bin/sh
# Forced command for the GitHub Actions deploy keys (docs/runbooks/provisioning.md):
#   command="$HOME/bin/smart-deploy <environment>",restrict ssh-ed25519 AAAA… smart-home-deploy-<environment>
# Accepts only "deploy <commit-sha>" for commits on main and runs that commit's deploy.sh.
set -eu
set -f

REPO="tkosiol/smart-home"
GITHUB_API="${SMART_DEPLOY_GITHUB_API:-https://api.github.com}"
GITHUB_RAW="${SMART_DEPLOY_GITHUB_RAW:-https://raw.githubusercontent.com}"

fail() {
  echo "smart-deploy: $1" >&2
  exit "$2"
}

environment="${1:-}"
case "$environment" in
  staging | production) ;;
  *) fail "invalid environment '$environment'" 2 ;;
esac

# shellcheck disable=SC2086 # splitting the client command into words is intended; globbing is off (set -f)
set -- ${SSH_ORIGINAL_COMMAND:-}
if [ "$#" -ne 2 ] || [ "$1" != deploy ]; then
  fail "usage: deploy <commit-sha>" 2
fi
sha="$2"
printf '%s' "$sha" | grep -Eq '^[0-9a-f]{40}$' || fail "invalid commit sha" 2

status=$(curl -fsS "$GITHUB_API/repos/$REPO/compare/main...$sha" | sed -n 's/^  "status": "\([a-z]*\)",$/\1/p')
case "$status" in
  behind | identical) ;;
  *) fail "commit $sha is not on main (status: ${status:-unknown})" 3 ;;
esac

workdir=$(mktemp -d)
trap 'rm -rf "$workdir"' EXIT INT TERM
for file in infra/deploy/deploy.sh infra/compose/compose.yaml; do
  curl -fsSL -o "$workdir/$(basename "$file")" "$GITHUB_RAW/$REPO/$sha/$file" || fail "could not fetch $file" 1
done

sh "$workdir/deploy.sh" "$environment" "$sha" "$workdir"
```

- [ ] **Step 3: `infra/deploy/deploy.sh`**

```sh
#!/bin/sh
# Deploys the images of one commit to one environment; rolls back automatically if the new version is unhealthy.
# Usage: deploy.sh <staging|production> <commit-sha> <dir containing that commit's compose.yaml>
set -eu

environment="$1"
sha="$2"
source_dir="$3"
stacks_dir="${SMART_STACKS_DIR:-$HOME/docker/apps}"

case "$environment" in
  staging) stack_dir="$stacks_dir/smart-staging" ;;
  production) stack_dir="$stacks_dir/smart-prod" ;;
  *) echo "deploy: invalid environment '$environment'" >&2; exit 2 ;;
esac

log() { echo "deploy[$environment]: $*"; }
fail() { echo "deploy[$environment]: $*" >&2; exit 1; }

[ -f "$stack_dir/.env" ] || fail "missing $stack_dir/.env – provision the environment first"

cp "$source_dir/compose.yaml" "$stack_dir/compose.yaml"
printf 'IMAGE_TAG=%s\n' "$sha" > "$stack_dir/deploy.env.next"
cd "$stack_dir"

next() { docker compose --env-file .env --env-file deploy.env.next "$@"; }
current() { docker compose --env-file .env --env-file deploy.env "$@"; }

rollback() {
  if [ -f deploy.env ]; then
    log "rolling back to $(cat deploy.env)"
    current up -d --wait --remove-orphans || log "rollback did not become healthy either"
  fi
}

log "pulling images for $sha"
next pull --quiet

log "starting database and broker"
next up -d --wait db broker

log "running migrations"
next run --rm --no-deps api node dist/migrate.js || fail "migrations failed – the running version was not touched"

log "starting the new version"
if ! next up -d --wait --remove-orphans; then
  rollback
  fail "the new version did not become healthy – rolled back"
fi

if ! next exec -T web wget -qO- http://127.0.0.1:8080/api/health/ready | grep -q '"status":"ok"'; then
  rollback
  fail "readiness check failed – rolled back"
fi

mv deploy.env.next deploy.env
log "deployed $sha"
```

- [ ] **Step 4: `infra/deploy/provision.sh`**

```bash
#!/usr/bin/env bash
# Creates a stack's .env on the VPS. Run it yourself in a terminal – secrets never pass through chat or CI.
# Usage: SMART_VPS=<user@host> infra/deploy/provision.sh <staging|production> [--force]
set -euo pipefail

environment="${1:-}"
force="${2:-}"
host="${SMART_VPS:?set SMART_VPS=<user@host> (see .local/server.md)}"

case "$environment" in
  staging) stack=smart-staging; domain=staging.smart.tillkosiol.de ;;
  production) stack=smart-prod; domain=smart.tillkosiol.de ;;
  *) echo "usage: provision.sh <staging|production> [--force]" >&2; exit 2 ;;
esac
remote_dir="docker/apps/$stack"

if ssh -n "$host" "test -e $remote_dir/.env" && [ "$force" != "--force" ]; then
  echo "$remote_dir/.env already exists on the VPS; rerun with --force to replace it" >&2
  exit 1
fi

generate() { openssl rand -hex 32; }

lines=(
  "STACK_NAME=$stack"
  "APP_DOMAIN=$domain"
  "DB_PASSWORD=$(generate)"
  "MQTT_API_PASSWORD=$(generate)"
)

if [ "$environment" = production ]; then
  read -r -p "B2 S3 endpoint (e.g. s3.eu-central-003.backblazeb2.com): " b2_endpoint
  read -r -p "B2 bucket for VPS backups: " b2_bucket
  read -r -p "B2 key ID (smart-vps-restic): " b2_key_id
  read -r -s -p "B2 application key: " b2_app_key; echo
  read -r -s -p "restic repository password (from your password manager): " restic_password; echo
  read -r -p "healthchecks.io ping URL for the nightly backup: " hc_backup
  read -r -p "healthchecks.io ping URL for the restore test: " hc_restore
  lines+=(
    "COMPOSE_PROFILES=backup"
    "B2_ENDPOINT=$b2_endpoint"
    "B2_BUCKET=$b2_bucket"
    "B2_KEY_ID=$b2_key_id"
    "B2_APP_KEY=$b2_app_key"
    "RESTIC_PASSWORD=$restic_password"
    "HC_BACKUP_URL=$hc_backup"
    "HC_RESTORE_URL=$hc_restore"
  )
fi

printf '%s\n' "${lines[@]}" | ssh "$host" "umask 077 && mkdir -p $remote_dir && cat > $remote_dir/.env"
echo "wrote $remote_dir/.env on the VPS (mode 600)"
```

`chmod +x infra/deploy/smart-deploy infra/deploy/deploy.sh infra/deploy/provision.sh`

- [ ] **Step 5: Tests laufen lassen – müssen bestehen**

Run: `bash infra/deploy/test/run-tests.sh`
Expected: letzte Zeile `deploy tests: 33 passed, 0 failed`.

- [ ] **Step 6: shellcheck**

```bash
docker run --rm -v "$PWD:/mnt" -w /mnt koalaman/shellcheck:v0.11.0 \
  infra/deploy/smart-deploy infra/deploy/deploy.sh infra/deploy/provision.sh \
  infra/deploy/test/run-tests.sh infra/deploy/test/stubs/docker infra/deploy/test/stubs/curl infra/deploy/test/stubs/ssh \
  infra/backup/backup.sh infra/backup/restore-test.sh infra/broker/entrypoint.sh \
  infra/local/smoke-test.sh infra/compose/test/stack-test.sh
```

Expected: keine Ausgabe. Befunde im Skript beheben; ein `# shellcheck disable=` nur mit Begründungskommentar.

- [ ] **Step 7: CI-Job `ops`**

In `.github/workflows/ci.yml` unter `jobs:` ergänzen:

```yaml
ops:
  name: ops
  runs-on: ubuntu-24.04
  steps:
    - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      with:
        persist-credentials: false
    - name: shellcheck
      run: >
        docker run --rm -v "$PWD:/mnt" -w /mnt koalaman/shellcheck:v0.11.0
        infra/deploy/smart-deploy infra/deploy/deploy.sh infra/deploy/provision.sh
        infra/deploy/test/run-tests.sh infra/deploy/test/stubs/docker infra/deploy/test/stubs/curl infra/deploy/test/stubs/ssh
        infra/backup/backup.sh infra/backup/restore-test.sh infra/broker/entrypoint.sh
        infra/local/smoke-test.sh infra/compose/test/stack-test.sh
    - name: deploy script tests
      run: bash infra/deploy/test/run-tests.sh
```

Run: `docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:latest -color`
Expected: keine Ausgabe.

- [ ] **Step 8: Commit**

```bash
pnpm format
git add infra/deploy .github/workflows/ci.yml
git commit -m "feat(infra): add guarded deploy wrapper, deploy and provisioning scripts"
```

---

### Task 11: Deploy-Workflows und Ruleset-Erweiterung

**Files:**

- Create: `.github/workflows/deploy.yml`, `.github/workflows/deploy-environment.yml`
- Modify: `infra/github/ruleset-main.json`

**Interfaces:**

- Consumes: `smart-deploy` (Task 10), Images (Tasks 6–8), GitHub Environments `staging`/`production` mit Secrets `DEPLOY_SSH_KEY`, `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_KNOWN_HOSTS` (angelegt in Task 13).
- Produces: Deploy-Kette nach erfolgreicher CI auf `main`; manueller Deploy/Rollback per `workflow_dispatch` (Eingaben `environment`, `sha`); Pflicht-Checks `stack` und `ops` im Ruleset.

- [ ] **Step 1: Wiederverwendbarer Deploy-Job**

`.github/workflows/deploy-environment.yml`:

```yaml
name: Deploy environment

on:
  workflow_call:
    inputs:
      environment:
        type: string
        required: true
      sha:
        type: string
        required: true
      url:
        type: string
        required: true

permissions:
  contents: read

jobs:
  deploy:
    name: deploy (${{ inputs.environment }})
    runs-on: ubuntu-24.04
    environment:
      name: ${{ inputs.environment }}
      url: ${{ inputs.url }}
    steps:
      - name: Validate input
        env:
          SHA: ${{ inputs.sha }}
        run: printf '%s' "$SHA" | grep -Eq '^[0-9a-f]{40}$'
      - name: Deploy via forced-command SSH key
        env:
          SHA: ${{ inputs.sha }}
          DEPLOY_SSH_KEY: ${{ secrets.DEPLOY_SSH_KEY }}
          DEPLOY_HOST: ${{ secrets.DEPLOY_HOST }}
          DEPLOY_USER: ${{ secrets.DEPLOY_USER }}
          DEPLOY_KNOWN_HOSTS: ${{ secrets.DEPLOY_KNOWN_HOSTS }}
        run: |
          install -m 700 -d ~/.ssh
          printf '%s\n' "$DEPLOY_SSH_KEY" > ~/.ssh/deploy_key
          chmod 600 ~/.ssh/deploy_key
          printf '%s\n' "$DEPLOY_KNOWN_HOSTS" > ~/.ssh/known_hosts
          ssh -i ~/.ssh/deploy_key -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes \
            "$DEPLOY_USER@$DEPLOY_HOST" "deploy $SHA"
      - name: Smoke test through the public URL
        env:
          URL: ${{ inputs.url }}
        run: |
          curl -fsS --retry 10 --retry-delay 6 --retry-all-errors "$URL/api/health/ready" | grep -q '"status":"ok"'
```

- [ ] **Step 2: Build- und Deploy-Kette**

`.github/workflows/deploy.yml`:

```yaml
name: Deploy

on:
  workflow_run:
    workflows: [CI]
    types: [completed]
    branches: [main]
  workflow_dispatch:
    inputs:
      environment:
        description: Target environment
        type: choice
        options: [staging, production]
        required: true
      sha:
        description: Full commit SHA on main whose images should run (rollback = older SHA)
        type: string
        required: true

permissions:
  contents: read

concurrency:
  group: deploy
  cancel-in-progress: false

jobs:
  build:
    name: build (${{ matrix.image }})
    if: >-
      github.event_name == 'workflow_run' &&
      github.event.workflow_run.conclusion == 'success' &&
      github.event.workflow_run.event == 'push'
    runs-on: ubuntu-24.04
    permissions:
      contents: read
      packages: write
    strategy:
      fail-fast: true
      matrix:
        include:
          - { image: api, context: ., file: apps/backend/Dockerfile }
          - { image: web, context: ., file: apps/frontend/Dockerfile }
          - { image: broker, context: infra/broker, file: infra/broker/Dockerfile }
          - { image: backup, context: infra/backup, file: infra/backup/Dockerfile }
    env:
      IMAGE: ghcr.io/tkosiol/smart-home-${{ matrix.image }}:${{ github.event.workflow_run.head_sha }}
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          ref: ${{ github.event.workflow_run.head_sha }}
          persist-credentials: false
      - uses: docker/setup-buildx-action@f87e5991a6d7451dcb8d9637bfbc97413f497069 # v4.4.1
      - uses: docker/login-action@dbcb813823bdd20940b903addbd779551569679f # v4.6.0
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - name: Build
        uses: docker/build-push-action@c3c9e263c25d99ce0380d002d59b67737d91b0dc # v7.4.0
        with:
          context: ${{ matrix.context }}
          file: ${{ matrix.file }}
          load: true
          tags: ${{ env.IMAGE }}
          labels: org.opencontainers.image.source=https://github.com/${{ github.repository }}
          cache-from: type=gha,scope=${{ matrix.image }}
          cache-to: type=gha,mode=max,scope=${{ matrix.image }}
      - name: Scan
        uses: aquasecurity/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25 # v0.36.0
        with:
          image-ref: ${{ env.IMAGE }}
          severity: CRITICAL,HIGH
          ignore-unfixed: true
          exit-code: '1'
      - name: Push
        run: docker push "$IMAGE"

  staging:
    needs: build
    uses: ./.github/workflows/deploy-environment.yml
    with:
      environment: staging
      sha: ${{ github.event.workflow_run.head_sha }}
      url: https://staging.smart.tillkosiol.de
    secrets: inherit

  production:
    needs: staging
    uses: ./.github/workflows/deploy-environment.yml
    with:
      environment: production
      sha: ${{ github.event.workflow_run.head_sha }}
      url: https://smart.tillkosiol.de
    secrets: inherit

  manual:
    if: github.event_name == 'workflow_dispatch'
    uses: ./.github/workflows/deploy-environment.yml
    with:
      environment: ${{ inputs.environment }}
      sha: ${{ inputs.sha }}
      url: ${{ inputs.environment == 'production' && 'https://smart.tillkosiol.de' || 'https://staging.smart.tillkosiol.de' }}
    secrets: inherit
```

- [ ] **Step 3: Ruleset um `stack` und `ops` erweitern**

In `infra/github/ruleset-main.json` unter `required_status_checks` ergänzen: `{ "context": "stack", "integration_id": 15368 }` und `{ "context": "ops", "integration_id": 15368 }`.

- [ ] **Step 4: Verifizieren**

```bash
docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:latest -color
python3 -m json.tool infra/github/ruleset-main.json > /dev/null && echo "ruleset json ok"
awk '/run: \|/{inrun=1; next} /^ *-? ?[A-Za-z_-]+:/{inrun=0} inrun && /\$\{\{/' .github/workflows/*.yml; grep -nE 'run: .*\$\{\{' .github/workflows/*.yml || echo "no expressions inside run scripts"
```

Expected: actionlint ohne Ausgabe; `ruleset json ok`; `no expressions inside run scripts` (SHAs gelangen nur über `env:` in Skripte).

- [ ] **Step 5: Commit**

```bash
pnpm format
git add .github/workflows infra/github/ruleset-main.json
git commit -m "ci: add build, scan and staged deploy workflows"
```

---

### Task 12: Runbooks und Doku

**Files:**

- Create: `docs/runbooks/deploy.md`, `docs/runbooks/provisioning.md`, `docs/runbooks/backup-restore.md`, `docs/runbooks/monitoring.md`
- Modify: `CLAUDE.md`, `README.md`

**Interfaces:** keine.

- [ ] **Step 1: `docs/runbooks/deploy.md`**

````markdown
# Runbook: Deploy und Rollback

## Normaler Ablauf

1. PR mergen → CI auf `main` läuft.
2. Workflow **Deploy** startet automatisch nach grüner CI: baut `api`, `web`, `broker`, `backup`, scannt sie mit Trivy und pusht `ghcr.io/tkosiol/smart-home-<image>:<sha>`.
3. **Staging** wird deployt und über `https://staging.smart.tillkosiol.de/api/health/ready` geprüft.
4. **Produktion** wartet auf Freigabe: GitHub → Actions → Deploy → „Review deployments“ → `production` → Approve.

## Was auf dem VPS passiert

`smart-deploy <environment>` (Forced Command) prüft, dass der Commit auf `main` liegt, lädt `infra/deploy/deploy.sh` und `infra/compose/compose.yaml` genau dieses Commits und ruft `deploy.sh` auf:

1. `docker compose pull`
2. `db` und `broker` starten
3. Migrationen (`node dist/migrate.js`) – schlägt das fehl, bleibt die laufende Version unangetastet
4. neue Version starten (`up -d --wait`) und `/api/health/ready` prüfen – sonst automatischer Rollback auf die Version aus `deploy.env`
5. `deploy.env` auf den neuen Commit setzen

## Rollback

GitHub → Actions → Deploy → „Run workflow“: `environment` wählen, `sha` = vollständiger SHA eines früheren Commits auf `main` (Images existieren für jeden gemergten Commit). Produktion verlangt wieder die Freigabe.

Voraussetzung: Migrationen sind rückwärtskompatibel (erst Neues hinzufügen, Altes erst in einem späteren Release entfernen).

## Fehlerbilder

| Symptom                                  | Ursache / Abhilfe                                                                                                                  |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `commit … is not on main`                | SHA stammt aus einem Branch oder Fork – nur gemergte Commits sind deploybar                                                        |
| `missing …/.env`                         | Umgebung nicht provisioniert → `docs/runbooks/provisioning.md`                                                                     |
| `pull access denied`                     | GHCR-Paket ist privat → Paket-Einstellungen auf GitHub: Visibility „Public“                                                        |
| `migrations failed`                      | Logs: `docker compose --env-file .env --env-file deploy.env.next run --rm --no-deps api node dist/migrate.js` im Stack-Verzeichnis |
| Smoke-Test schlägt fehl, Deploy war grün | Reverse-Proxy-Eintrag oder DNS prüfen (`docs/runbooks/provisioning.md`)                                                            |

## Wrapper aktualisieren

Änderungen an `infra/deploy/smart-deploy` wirken erst nach erneutem Kopieren auf den VPS:

```bash
scp infra/deploy/smart-deploy <DEPLOY_USER>@<VPS_HOST>:bin/smart-deploy
ssh <DEPLOY_USER>@<VPS_HOST> chmod 755 bin/smart-deploy
```
````

- [ ] **Step 2: `docs/runbooks/provisioning.md`**

````markdown
# Runbook: Umgebungen provisionieren

Einmalig pro Umgebung (`staging`, `production`). Konkrete Werte für `<…>` stehen in `.local/`.

## 1. Deploy-Wrapper auf dem VPS

```bash
ssh <DEPLOY_USER>@<VPS_HOST> mkdir -p bin docker/apps
scp infra/deploy/smart-deploy <DEPLOY_USER>@<VPS_HOST>:bin/smart-deploy
ssh <DEPLOY_USER>@<VPS_HOST> chmod 755 bin/smart-deploy
```

## 2. Deploy-Key pro Umgebung

```bash
ssh-keygen -t ed25519 -N '' -C smart-home-deploy-<environment> -f <tmp>/deploy-<environment>
```

Öffentlichen Schlüssel auf dem VPS an `~/.ssh/authorized_keys` anhängen:

```
command="/home/<DEPLOY_USER>/bin/smart-deploy <environment>",restrict ssh-ed25519 AAAA… smart-home-deploy-<environment>
```

Privaten Schlüssel als Environment-Secret hinterlegen und lokal löschen:

```bash
gh secret set DEPLOY_SSH_KEY --env <environment> < <tmp>/deploy-<environment>
gh secret set DEPLOY_HOST --env <environment> --body '<VPS_HOST>'
gh secret set DEPLOY_USER --env <environment> --body '<DEPLOY_USER>'
ssh-keyscan -t ed25519 <VPS_HOST> | gh secret set DEPLOY_KNOWN_HOSTS --env <environment>
rm <tmp>/deploy-<environment> <tmp>/deploy-<environment>.pub
```

## 3. GitHub Environments

`staging`: nur `main` darf deployen. `production`: zusätzlich Freigabe durch Till.

## 4. `.env` der Umgebung (Till, im eigenen Terminal)

```bash
SMART_VPS=<DEPLOY_USER>@<VPS_HOST> infra/deploy/provision.sh staging
SMART_VPS=<DEPLOY_USER>@<VPS_HOST> infra/deploy/provision.sh production
```

Produktion fragt B2-Zugang, restic-Passwort und healthchecks.io-URLs ab (vorher im Passwortmanager bereitlegen). DB- und MQTT-Passwörter werden generiert; sie liegen verschlüsselt im Backup.

## 5. Reverse Proxy (Nginx Proxy Manager)

Proxy Host pro Umgebung: Domain → `http://smart-prod-web:8080` bzw. `http://smart-staging-web:8080`, „Block Common Exploits“ an; SSL: neues Let's-Encrypt-Zertifikat, „Force SSL“, „HTTP/2“, „HSTS“.

## 6. Prüfen

```bash
ssh -i <tmp-key> <DEPLOY_USER>@<VPS_HOST> "deploy 0000000000000000000000000000000000000000"   # → not on main
ssh -i <tmp-key> <DEPLOY_USER>@<VPS_HOST> "ls"                                                # → usage
```
````

- [ ] **Step 3: `docs/runbooks/backup-restore.md`**

````markdown
# Runbook: Backup und Restore

## Überblick

Der Container `backup` im Stack `smart-prod` (Profil `backup`) läuft mit supercronic:

| Zeit (UTC)          | Aufgabe                                                                                                                          |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| täglich 03:15       | `backup.sh`: DB-Dump + Stack-Verzeichnis → restic (B2, EU), Aufbewahrung 7 täglich / 4 wöchentlich / 6 monatlich, `restic check` |
| 1. des Monats 04:45 | `restore-test.sh`: letzter Dump → Datenbank `restore_check`, Prüfung, Löschen                                                    |

Beide melden Start/Erfolg/Fehler an healthchecks.io.

## Manuell auslösen

Im Stack-Verzeichnis `~/docker/apps/smart-prod`:

```bash
docker compose --env-file .env --env-file deploy.env exec -T backup backup.sh
docker compose --env-file .env --env-file deploy.env exec -T backup restore-test.sh
docker compose --env-file .env --env-file deploy.env exec -T backup restic snapshots
```

## Vollständige Wiederherstellung (VPS verloren)

1. Neuen VPS mit Docker vorbereiten, Umgebung provisionieren (`provisioning.md`) – beim `.env` die Werte aus dem Backup verwenden:
   ```bash
   docker run --rm -e RESTIC_REPOSITORY=s3:https://<B2_S3_ENDPOINT>/<B2_BUCKET> -e RESTIC_PASSWORD -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY \
     -v "$PWD/restore:/restore" restic/restic:0.19.1 restore latest --tag config --target /restore
   ```
   (`RESTIC_PASSWORD`, B2-Keys aus dem Passwortmanager als Umgebungsvariablen setzen.)
2. Wiederhergestellte `.env` nach `~/docker/apps/smart-prod/.env` kopieren (Rechte 600).
3. Letzten erfolgreichen Commit über den Deploy-Workflow manuell deployen.
4. Datenbank wiederherstellen (Stack läuft, API kurz stoppen):
   ```bash
   docker compose --env-file .env --env-file deploy.env stop api
   docker compose --env-file .env --env-file deploy.env exec -T backup sh -c 'restic dump --tag db latest smart.dump > /tmp/smart.dump'
   docker compose --env-file .env --env-file deploy.env exec -T backup sh -c \
     'psql -d postgres -c "DROP DATABASE smart" -c "CREATE DATABASE smart" && psql -d smart -c "CREATE EXTENSION IF NOT EXISTS timescaledb" -c "SELECT timescaledb_pre_restore()" && (pg_restore --no-owner -d smart /tmp/smart.dump || true) && psql -d smart -c "SELECT timescaledb_post_restore()"'
   docker compose --env-file .env --env-file deploy.env start api
   ```
5. `/api/health/ready` prüfen.

Pi-Backups folgen in Etappe 5.
````

- [ ] **Step 4: `docs/runbooks/monitoring.md`**

````markdown
# Runbook: Monitoring

| Was                       | Wo                                                                                                                   | Alarm  |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------ |
| Erreichbarkeit Produktion | UptimeRobot: Keyword-Monitor auf `https://smart.tillkosiol.de/api/health/ready`, Keyword `"status":"ok"`, alle 5 min | E-Mail |
| Nächtliches Backup        | healthchecks.io, Check „vps-backup“ (Cron `15 3 * * *`, UTC, Grace 2 h)                                              | E-Mail |
| Restore-Test              | healthchecks.io, Check „restore-test“ (Cron `45 4 1 * *`, UTC, Grace 6 h)                                            | E-Mail |
| Host/Container            | Beszel (bereits vorhanden)                                                                                           | –      |

## Logs

```bash
cd ~/docker/apps/smart-prod
docker compose --env-file .env --env-file deploy.env logs --since 1h api
```

API-Logs sind JSON; jede Anfrage hat eine `traceId`, die auch im Response-Header `x-trace-id` steht.
````

- [ ] **Step 5: `CLAUDE.md` und `README.md`**

In `CLAUDE.md` die Befehlstabelle um diese Zeilen ergänzen:

```
| Backend-Integrationstests (Docker nötig) | `pnpm --filter @smart/backend test` |
| Produktions-Stack lokal testen | `sh infra/compose/test/stack-test.sh` |
| Deploy-Skripte testen | `bash infra/deploy/test/run-tests.sh` |
```

und unter „Arbeitsweise“ ergänzen: „Deploy, Provisionierung, Backups und Monitoring: `docs/runbooks/`. Secrets für Umgebungen entstehen nur über `infra/deploy/provision.sh`, das Till selbst ausführt – Claude fragt nie nach Secret-Werten.“

In `README.md` unter „Struktur“ ergänzen: `| tests/e2e | Playwright-Smoke-Tests gegen den Produktions-Stack |` und `| docs/runbooks | Deploy, Provisionierung, Backup, Monitoring |`.

- [ ] **Step 6: Datenschutzprüfung und Commit**

```bash
git grep -nE -f .local/private-patterns.txt -- . || echo "no private data"
pnpm format
git add docs CLAUDE.md README.md
git commit -m "docs: add runbooks for deploy, provisioning, backups and monitoring"
```

Expected: `no private data`.

---

### Task 13: Provisionierung (mit Till, nach außen wirksam)

Vor jedem Schritt mit Wirkung nach außen kurz bei Till bestätigen. Keine Secret-Werte im Chat.

**Files:** keine Repo-Änderungen (Werte landen in `.local/` und auf dem VPS).

**Interfaces:**

- Produces: GitHub Environments `staging`, `production` mit Secrets; Wrapper unter `~/bin/smart-deploy`; zwei eingeschränkte Deploy-Keys; `.env` beider Stacks; NPM-Proxy-Hosts; healthchecks-Checks; aktualisiertes Ruleset.

- [ ] **Step 1: Branch pushen und PR als Entwurf öffnen** (damit CI läuft, ohne Deploy)

```bash
git push -u origin feat/etappe-2-durchstich
gh pr create --draft --base main --title "feat(infra): end-to-end delivery to staging and production (Etappe 2)" --body "Implements docs/superpowers/plans/2026-10-11-etappe-2-durchstich.md."
gh pr checks --watch
```

Expected: `secrets`, `verify`, `infra-local`, `stack`, `ops`, `pr-message`, CodeQL grün.

- [ ] **Step 2: GitHub Environments**

```bash
gh api -X PUT repos/tkosiol/smart-home/environments/staging --input - <<'JSON'
{"deployment_branch_policy":{"protected_branches":true,"custom_branch_policies":false}}
JSON
gh api -X PUT repos/tkosiol/smart-home/environments/production --input - <<'JSON'
{"reviewers":[{"type":"User","id":230231571}],"prevent_self_review":false,"deployment_branch_policy":{"protected_branches":true,"custom_branch_policies":false}}
JSON
gh api repos/tkosiol/smart-home/environments --jq '.environments[] | {name, rules: [.protection_rules[].type]}'
```

Expected: `staging` mit `branch_policy`; `production` mit `required_reviewers` und `branch_policy`.

- [ ] **Step 3: Wrapper und Deploy-Keys installieren** (Werte für Host/User aus `.local/server.md`)

```bash
VPS=<DEPLOY_USER>@<VPS_HOST>
ssh "$VPS" mkdir -p bin docker/apps
scp infra/deploy/smart-deploy "$VPS":bin/smart-deploy && ssh "$VPS" chmod 755 bin/smart-deploy
KEYDIR=$(mktemp -d)
for env in staging production; do
  ssh-keygen -q -t ed25519 -N '' -C "smart-home-deploy-$env" -f "$KEYDIR/deploy-$env"
  printf 'command="/home/<DEPLOY_USER>/bin/smart-deploy %s",restrict %s\n' "$env" "$(cat "$KEYDIR/deploy-$env.pub")" | ssh "$VPS" 'cat >> ~/.ssh/authorized_keys'
  gh secret set DEPLOY_SSH_KEY --env "$env" < "$KEYDIR/deploy-$env"
  gh secret set DEPLOY_HOST --env "$env" --body '<VPS_HOST>'
  gh secret set DEPLOY_USER --env "$env" --body '<DEPLOY_USER>'
  ssh-keyscan -t ed25519 <VPS_HOST> 2>/dev/null | gh secret set DEPLOY_KNOWN_HOSTS --env "$env"
done
```

- [ ] **Step 4: Keys prüfen, dann lokal löschen**

```bash
ssh -i "$KEYDIR/deploy-staging" -o IdentitiesOnly=yes "$VPS" "deploy 0000000000000000000000000000000000000000"; echo "exit=$?"
ssh -i "$KEYDIR/deploy-staging" -o IdentitiesOnly=yes "$VPS" "ls"; echo "exit=$?"
rm "$KEYDIR"/deploy-staging "$KEYDIR"/deploy-staging.pub "$KEYDIR"/deploy-production "$KEYDIR"/deploy-production.pub && rmdir "$KEYDIR"
gh secret list --env staging; gh secret list --env production
```

Expected: erster Aufruf `commit … is not on main` mit `exit=3`; zweiter `usage: deploy <commit-sha>` mit `exit=2`; je vier Secrets pro Environment.

- [ ] **Step 5: Till – healthchecks.io-Checks anlegen**

Im Projekt „smart-home“: Check `vps-backup` (Schedule: Cron `15 3 * * *`, Zeitzone UTC, Grace 2 h) und Check `restore-test` (Cron `45 4 1 * *`, UTC, Grace 6 h). Ping-URLs nicht in den Chat kopieren – sie werden in Step 6 abgefragt.

- [ ] **Step 6: Till – `.env` beider Umgebungen schreiben** (im eigenen Terminal, nicht über `!`)

```bash
SMART_VPS=<DEPLOY_USER>@<VPS_HOST> infra/deploy/provision.sh staging
SMART_VPS=<DEPLOY_USER>@<VPS_HOST> infra/deploy/provision.sh production
```

Danach prüft Claude (ohne Inhalte anzuzeigen):

```bash
ssh "$VPS" 'stat -c "%a %n" docker/apps/smart-staging/.env docker/apps/smart-prod/.env; grep -c "=" docker/apps/smart-staging/.env docker/apps/smart-prod/.env'
```

Expected: beide `600`; Staging 4 Einträge, Produktion 12 Einträge.

- [ ] **Step 7: Till – Proxy Hosts im Nginx Proxy Manager**

| Domain                        | Forward                               | SSL                                          |
| ----------------------------- | ------------------------------------- | -------------------------------------------- |
| `staging.smart.tillkosiol.de` | `http` · `smart-staging-web` · `8080` | neues LE-Zertifikat, Force SSL, HTTP/2, HSTS |
| `smart.tillkosiol.de`         | `http` · `smart-prod-web` · `8080`    | neues LE-Zertifikat, Force SSL, HTTP/2, HSTS |

„Block Common Exploits“ an, „Websockets Support“ aus. (Bis zum ersten Deploy antworten die Hosts mit 502 – erwartet.)

- [ ] **Step 8: Ruleset aktualisieren**

```bash
RULESET_ID=$(gh api repos/tkosiol/smart-home/rulesets --jq '.[] | select(.name == "main") | .id')
gh api -X PUT "repos/tkosiol/smart-home/rulesets/$RULESET_ID" --input infra/github/ruleset-main.json --jq '[.rules[] | select(.type == "required_status_checks") | .parameters.required_status_checks[].context]'
```

Expected: `["secrets","verify","infra-local","pr-message","stack","ops"]`.

- [ ] **Step 9: `.local/` nachziehen**

In `.local/server.md` einen Abschnitt „Smart Home Stacks“ ergänzen (Verzeichnisse, Wrapper-Pfad, Key-Kommentare `smart-home-deploy-*`, Proxy-Hosts) und in `.local/secrets-inventory.md` Status der Deploy-Keys, DB-/MQTT-Passwörter, restic-Passwort und Healthcheck-URLs auf „angelegt 2026-…“ setzen.

---

### Task 14: Rollout und Abnahme

**Files:** keine (außer ggf. Fixes, die als eigene Commits über PR laufen).

- [ ] **Step 1: PR fertigstellen und mergen** (nach Tills Freigabe)

```bash
gh pr ready
gh pr checks --watch
gh pr merge --squash --delete-branch
git switch main && git pull --ff-only
```

- [ ] **Step 2: Deploy-Lauf beobachten**

```bash
gh run list --workflow Deploy --limit 1
gh run watch "$(gh run list --workflow Deploy --limit 1 --json databaseId --jq '.[0].databaseId')"
```

Expected: vier `build`-Jobs grün (Trivy ohne CRITICAL/HIGH), `staging` grün, `production` wartet auf Freigabe.

Schlägt `staging` mit `pull access denied` fehl: Die GHCR-Pakete sind privat. Till stellt unter github.com → Profil → Packages → `smart-home-api`, `-web`, `-broker`, `-backup` → Package settings → „Change visibility“ → Public um; danach `gh run rerun <run-id> --failed`.

- [ ] **Step 3: Staging prüfen**

```bash
curl -fsS https://staging.smart.tillkosiol.de/api/health/ready; echo
E2E_BASE_URL=https://staging.smart.tillkosiol.de pnpm --filter @smart/e2e e2e
curl -sI https://staging.smart.tillkosiol.de/ | grep -iE "strict-transport-security|content-security-policy"
```

Expected: `{"status":"ok",…}`; Playwright grün; HSTS-Header (vom Proxy) und CSP vorhanden.

- [ ] **Step 4: Till – Produktion freigeben**

GitHub → Actions → Deploy → laufender Run → „Review deployments“ → `production` → Approve. Danach:

```bash
curl -fsS https://smart.tillkosiol.de/api/health/ready; echo
```

Expected: `{"status":"ok","checks":{"database":"up","broker":"up"}}`.

- [ ] **Step 5: Erstes Backup und Restore-Test in Produktion**

```bash
ssh "$VPS" 'cd docker/apps/smart-prod && docker compose --env-file .env --env-file deploy.env exec -T backup backup.sh && docker compose --env-file .env --env-file deploy.env exec -T backup restore-test.sh'
```

Expected: `backup completed`; `restore test passed (1 migrations)`. Till sieht beide Checks in healthchecks.io auf „up“.

- [ ] **Step 6: Till – UptimeRobot-Monitor**

„Add New Monitor“ → Typ „Keyword“ → URL `https://smart.tillkosiol.de/api/health/ready` → Keyword `"status":"ok"` (Alert, wenn nicht vorhanden) → Intervall 5 min → Alert-Kontakt: E-Mail. Monitor zeigt „Up“.

- [ ] **Step 7: Rollback-Probe auf Staging**

```bash
gh workflow run Deploy -f environment=staging -f sha="$(git rev-parse HEAD)"
gh run watch "$(gh run list --workflow Deploy --limit 1 --json databaseId --jq '.[0].databaseId')"
```

Expected: manueller Deploy desselben Commits läuft grün durch (beweist den Rollback-Pfad über `workflow_dispatch`).

- [ ] **Step 8: Memory und `.local/` aktualisieren**

Projekt-Memory: Stand „Etappe 2 abgeschlossen, Prod/Staging live, Backups + Monitoring aktiv“; nächster Schritt Plan für Etappe 3 (Design-System).
