# Etappe 0 + 1: Vorbereitung und Repo-Fundament – Umsetzungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein öffentliches Monorepo `tkosiol/smart-home`, in dem Contracts, Backend und Frontend als lauffähiges Gerüst existieren, alle Architekturregeln maschinell geprüft werden, Secrets nicht ins Repo gelangen können und jede Änderung über PR + grüne CI läuft.

**Architecture:** pnpm-Workspaces mit `apps/backend` (NestJS 12, ESM), `apps/frontend` (Angular 22, zoneless), `packages/contracts` (Zod-Schemas, ESM) und `tools/lint-config` (ESLint-/Stylelint-Konfiguration inkl. eigener Regeln, getestet). Lokale Infrastruktur (TimescaleDB, Mosquitto, Mailpit) per docker compose. GitHub Actions prüfen jeden PR; `main` ist per Ruleset geschützt.

**Tech Stack:** Node 24.21.0, pnpm 12.11.2, TypeScript 6.0.3, Angular 22.2.x, NestJS 12.x, Zod 4.6.5, Vitest, ESLint 10 (flat config) + typescript-eslint + angular-eslint + eslint-plugin-boundaries 7, Stylelint 17, lefthook, gitleaks 8.30.1, commitlint, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-10-11-smart-home-architecture-design.md` (Abschnitte 3.1, 5, 6.1, 6.3, 8.2, 9, 10.3, 12, 13 – Etappen 0 und 1)

## Global Constraints

- Node.js **24.21.0** (`.nvmrc`), `engines.node`: `>=24.21.0 <25`.
- pnpm **12.11.2** (`packageManager`-Feld).
- TypeScript **6.0.3** überall (Angular 22 verlangt `>=6.0 <6.1`; typescript-eslint verlangt `<6.1`). Kein TypeScript 7.
- Angular **22.2.x**, NestJS **12.x** (ESM, `"type": "module"`), Zod **4.6.5**.
- Docker-Images gepinnt: `timescale/timescaledb:2.30.2-pg17`, `eclipse-mosquitto:2.1.2-alpine`, `axllent/mailpit:v1.31.5`, `ghcr.io/gitleaks/gitleaks:v8.30.1`.
- GitHub Actions auf Commit-SHA gepinnt: `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1` (v7.0.1), `actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1` (v7.1.0), `pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413` (v6.1.0), `github/codeql-action/*@24c54180a607b1449ed407dd24f251e4e9147c8d` (v4.38.3).
- Code, Bezeichner, Code-Kommentare, Commit-Messages: **Englisch**. Projektdoku in `docs/`: **Deutsch**.
- Conventional Commits; **keine KI-Attribution** (kein `Co-Authored-By: Claude`, kein „Generated with …“) in Commits oder PRs.
- Das Repo ist öffentlich: **keine IP-Adressen, Hostnamen privater Geräte, E-Mail-Adressen oder Secrets** in versionierten Dateien. Private Werte nur in `.local/`, `CLAUDE.local.md`, `.env`-Dateien (alle gitignored) oder im Passwortmanager.
- Lokale Host-Ports nur auf `127.0.0.1`: DB `5433`, MQTT `1884`, Mailpit-SMTP `1025`, Mailpit-UI `8025`.
- Alle Arbeiten der Etappe 1 laufen auf dem Branch `feat/repo-foundation`; `main` enthält bis zum ersten PR nur die Spec und diesen Plan.

## Review Focus

1. **Frischer Clone ohne `packages/contracts/dist`:** `pnpm install` muss die Contracts bauen, sodass `typecheck`, `test` und `build` von Backend und Frontend sofort funktionieren. → Test in Task 3, Schritt 8.
2. **Lint-Regeln greifen auf echten Pfaden nicht** (Glob passt nur auf Fixtures, nicht auf `apps/frontend/src/app/...`): Die Regeln wirken dann scheinbar, schützen aber nichts. → Canary-Test gegen die echte `eslint.config.mjs` in Task 6, Schritt 9.
3. **Zeitstempel mit Offset oder ohne Zone werden akzeptiert, oder Tests hängen von der lokalen Zeitzone ab.** → Tests in Task 3 + `pnpm test:tz` (Task 3, Schritt 7; CI in Task 9).
4. **Ein Commit mit Secret oder KI-Attribution geht trotzdem durch** (Hook nicht installiert, gitleaks fehlt). → Negativtests in Task 2, Schritte 6–8.
5. **Lokale Infrastruktur ist offener als gedacht:** anonymes MQTT erlaubt, Ports auf `0.0.0.0`, DB-Zeitzone nicht UTC. → Smoke-Test in Task 7.

---

## Dateistruktur nach Etappe 1

```
smart/                                   (lokaler Ordner; GitHub: tkosiol/smart-home)
├── .github/
│   ├── workflows/ci.yml                 secrets, verify, infra-local
│   ├── workflows/codeql.yml
│   ├── dependabot.yml
│   └── pull_request_template.md
├── apps/
│   ├── backend/                         NestJS 12 (generiert + angepasst)
│   │   ├── src/main.ts, app.module.ts, app.setup.ts
│   │   ├── src/platform/observability/{health.controller.ts, observability.module.ts, index.ts}
│   │   ├── src/core/README.md, src/modules/README.md
│   │   └── test/health.e2e-spec.ts
│   └── frontend/                        Angular 22 (generiert + angepasst)
│       └── src/app/{app.ts, app.config.ts, app.routes.ts, app.spec.ts, core/contracts-wiring.spec.ts}
├── packages/contracts/                  @smart/contracts
│   └── src/{index.ts, health.ts, health.spec.ts, time.ts, time.spec.ts}
├── tools/lint-config/                   @smart/lint-config
│   ├── eslint/{index.mjs, plugin.mjs, backend-boundaries.mjs, frontend-boundaries.mjs,
│   │          frontend-restricted-imports.mjs, rules/no-component-styles.mjs}
│   ├── stylelint/index.mjs
│   └── test/{no-component-styles.spec.mjs, eslint-architecture.spec.mjs, stylelint.spec.mjs, fixture/…}
├── infra/
│   ├── local/{compose.yaml, .env.example, smoke-test.sh, mosquitto/{mosquitto.conf, entrypoint.sh}}
│   └── github/ruleset-main.json
├── docs/
│   ├── architecture/overview.md
│   ├── adr/{README.md, 0000-template.md, 0001-…md … 0017-…md}
│   └── superpowers/{specs,plans}/
├── eslint.config.mjs, stylelint.config.mjs, commitlint.config.mjs, lefthook.yml, .gitleaks.toml
├── package.json, pnpm-workspace.yaml, pnpm-lock.yaml, .nvmrc, .editorconfig, .gitattributes
├── .gitignore, .prettierrc.json, .prettierignore
├── README.md, CLAUDE.md
└── (gitignored) CLAUDE.local.md, .local/{README.md, server.md, pi.md, secrets-inventory.md}
```

---

## Etappe 0: Vorbereitung

### Task 0: Werkzeuge, DNS und Accounts

Diese Task besteht überwiegend aus Handgriffen von Till. Claude prüft die Ergebnisse.

**Files:** keine Repo-Dateien.

- [ ] **Step 1: Werkzeuge installieren (Till, im Terminal)**

```bash
brew install fnm gh gitleaks
echo 'eval "$(fnm env --use-on-cd --version-file-strategy=recursive --shell zsh)"' >> ~/.zshrc
exec zsh
fnm install 24.21.0
fnm default 24.21.0
npm install -g pnpm@12.11.2
```

- [ ] **Step 2: GitHub CLI anmelden (Till)**

Im Claude-Code-Prompt eingeben: `! gh auth login` → GitHub.com → SSH oder HTTPS → im Browser bestätigen.

- [ ] **Step 3: Docker Desktop starten (Till)**

- [ ] **Step 4: Werkzeuge verifizieren (Claude)**

Run:

```bash
node -v && pnpm -v && gh auth status && gitleaks version && docker info --format '{{.ServerVersion}}'
```

Expected: `v24.21.0`, `12.11.2`, `Logged in to github.com account tkosiol`, `8.30.1`, eine Docker-Versionsnummer. Weicht etwas ab: stoppen und mit Till klären.

- [ ] **Step 5: DNS-Eintrag anlegen (Till, netcup CCP → Domain tillkosiol.de → DNS)**

Zwei neue Einträge (Werte aus `.local/server.md` bzw. der Server-Doku):

| Host      | Typ  | Ziel         |
| --------- | ---- | ------------ |
| `*.smart` | A    | `<VPS_IPV4>` |
| `*.smart` | AAAA | `<VPS_IPV6>` |

- [ ] **Step 6: DNS verifizieren (Claude, kann bis zu einige Stunden dauern)**

Run:

```bash
dig +short A staging.smart.tillkosiol.de; dig +short A mqtt.smart.tillkosiol.de; dig +short A smart.tillkosiol.de
```

Expected: alle drei liefern die VPS-IPv4. Blockiert Etappe 1 nicht; muss vor Etappe 2 erledigt sein.

- [ ] **Step 7: Accounts anlegen (Till; blockiert Etappe 1 nicht, nötig ab Etappe 2 bzw. 4)**

| Dienst          | Hinweis                                                                                                       | benötigt ab |
| --------------- | ------------------------------------------------------------------------------------------------------------- | ----------- |
| Backblaze B2    | Bei der Registrierung Region **EU Central** wählen (nachträglich nicht änderbar). Noch keinen Bucket anlegen. | Etappe 2    |
| UptimeRobot     | Free-Plan                                                                                                     | Etappe 2    |
| healthchecks.io | Free-Plan                                                                                                     | Etappe 2    |
| Resend          | Free-Plan; Domain wird in Etappe 4 verifiziert                                                                | Etappe 4    |

Zugangsdaten nur in den Passwortmanager. Claude trägt in Task 8 lediglich _dass_ und _wo_ sie existieren in `.local/secrets-inventory.md` ein.

---

## Etappe 1: Repo-Fundament

### Task 1: Workspace-Grundgerüst

**Files:**

- Create: `package.json`, `pnpm-workspace.yaml`, `.nvmrc`, `.editorconfig`, `.gitattributes`, `.gitignore`, `.prettierrc.json`, `.prettierignore`

**Interfaces:**

- Produces: Root-Skripte `format`, `format:check`, `lint`, `typecheck`, `test`, `test:tz`, `build`, `contracts:build`, `infra:up`, `infra:down`, `infra:test` (die referenzierten Pakete/Dateien entstehen in späteren Tasks; bis dahin werden die Skripte nicht aufgerufen).

- [ ] **Step 1: Branch anlegen**

```bash
cd <REPO_ROOT>
git switch -c feat/repo-foundation
```

- [ ] **Step 2: `.nvmrc`**

```
24.21.0
```

- [ ] **Step 3: `package.json`**

```json
{
  "name": "smart-home",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@12.11.2",
  "engines": {
    "node": ">=24.21.0 <25"
  },
  "scripts": {
    "prepare": "lefthook install && pnpm contracts:build",
    "contracts:build": "pnpm --filter @smart/contracts build",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "lint": "eslint . && stylelint --allow-empty-input \"apps/frontend/**/*.scss\"",
    "typecheck": "pnpm -r --if-present typecheck",
    "test": "pnpm -r --if-present test",
    "test:tz": "TZ=Pacific/Chatham pnpm -r --if-present test",
    "build": "pnpm -r --if-present build",
    "infra:up": "docker compose -f infra/local/compose.yaml up -d --wait",
    "infra:down": "docker compose -f infra/local/compose.yaml down",
    "infra:test": "sh infra/local/smoke-test.sh"
  }
}
```

- [ ] **Step 4: `pnpm-workspace.yaml`**

```yaml
packages:
  - apps/*
  - packages/*
  - tools/*

engineStrict: true
```

- [ ] **Step 5: `.editorconfig`**

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
indent_style = space
indent_size = 2
insert_final_newline = true
trim_trailing_whitespace = true

[*.md]
trim_trailing_whitespace = false
```

- [ ] **Step 6: `.gitattributes`**

```
* text=auto eol=lf
*.png binary
*.jpg binary
*.ico binary
*.woff2 binary
```

- [ ] **Step 7: `.gitignore`**

```gitignore
# dependencies
node_modules/

# build output
dist/
coverage/
.angular/
*.tsbuildinfo

# environment and secrets
.env
.env.*
!.env.example
*.pem
*.key
*.crt
*.csr
*.srl

# private, never committed (see CLAUDE.md)
.local/
CLAUDE.local.md

# OS / editor
.DS_Store
.idea/
.vscode/*
!.vscode/extensions.json
```

- [ ] **Step 8: `.prettierrc.json` und `.prettierignore`**

`.prettierrc.json`:

```json
{
  "singleQuote": true,
  "printWidth": 100,
  "trailingComma": "all",
  "overrides": [{ "files": "*.html", "options": { "parser": "angular" } }]
}
```

`.prettierignore`:

```
pnpm-lock.yaml
**/dist/
**/coverage/
**/.angular/
tools/lint-config/test/fixture/
```

- [ ] **Step 9: Ignore-Regeln verifizieren**

Run:

```bash
mkdir -p .local && touch .local/x CLAUDE.local.md .env .env.example
git check-ignore -v .local/x CLAUDE.local.md .env
git check-ignore .env.example || echo ".env.example NOT ignored (correct)"
rm -f .local/x CLAUDE.local.md .env .env.example
```

Expected: die drei Pfade werden mit der passenden `.gitignore`-Zeile ausgegeben; danach `.env.example NOT ignored (correct)`.

- [ ] **Step 10: Commit**

Die Hooks existieren noch nicht; dieser Commit läuft ohne Prüfung.

```bash
git add package.json pnpm-workspace.yaml .nvmrc .editorconfig .gitattributes .gitignore .prettierrc.json .prettierignore
git commit -m "chore(repo): add pnpm workspace skeleton"
```

---

### Task 2: Commit-Hygiene (lefthook, gitleaks, commitlint, Prettier)

**Files:**

- Create: `lefthook.yml`, `.gitleaks.toml`, `commitlint.config.mjs`
- Modify: `package.json` (devDependencies)

**Interfaces:**

- Produces: Pre-Commit-Hook (`gitleaks`, `prettier`), Commit-Msg-Hook (`commitlint` inkl. Regel `no-ai-attribution`). Task 6 ergänzt `eslint` im Pre-Commit-Hook.

- [ ] **Step 1: Dev-Dependencies installieren**

```bash
pnpm add -Dw prettier@3.9.10 lefthook@2.2.1 @commitlint/cli@21.2.3 @commitlint/config-conventional@21.2.3
```

Meldet pnpm „Ignored build scripts: lefthook“ (oder andere Pakete), den in der Meldung genannten Konfigurationseintrag in `pnpm-workspace.yaml` ergänzen (nur für `lefthook`, `esbuild`, `@swc/core`, `nx`/`@parcel/watcher`, falls genannt) und `pnpm install` erneut ausführen.

Der `prepare`-Schritt läuft dabei mit; `pnpm contracts:build` findet noch kein Paket `@smart/contracts` und tut nichts. Bricht `prepare` deswegen ab, in diesem Schritt `pnpm exec lefthook install` direkt ausführen – ab Task 3 läuft `prepare` vollständig.

- [ ] **Step 2: `.gitleaks.toml`**

```toml
title = "smart-home"

[extend]
useDefault = true

[[allowlists]]
description = "Lockfile contains integrity hashes, not secrets"
paths = ['''pnpm-lock\.yaml''']
```

- [ ] **Step 3: `commitlint.config.mjs`**

```js
const AI_ATTRIBUTION = /co-authored-by:[^\n]*(claude|anthropic)|generated with[^\n]*claude/i;

export default {
  extends: ['@commitlint/config-conventional'],
  plugins: [
    {
      rules: {
        'no-ai-attribution': ({ raw }) => [
          !AI_ATTRIBUTION.test(raw ?? ''),
          'remove AI attribution lines (repository convention, see CLAUDE.md)',
        ],
      },
    },
  ],
  rules: {
    'no-ai-attribution': [2, 'always'],
    'scope-enum': [
      2,
      'always',
      [
        'repo',
        'frontend',
        'backend',
        'contracts',
        'ui',
        'lint',
        'infra',
        'gateway',
        'ci',
        'docs',
        'deps',
      ],
    ],
  },
};
```

- [ ] **Step 4: `lefthook.yml`**

```yaml
pre-commit:
  parallel: true
  commands:
    gitleaks:
      run: gitleaks git --pre-commit --staged --redact --no-banner
    prettier:
      glob: '*.{ts,js,mjs,cjs,json,md,yml,yaml,html,scss}'
      run: pnpm exec prettier --write --ignore-unknown {staged_files}
      stage_fixed: true

commit-msg:
  commands:
    commitlint:
      run: pnpm exec commitlint --edit {1}
```

- [ ] **Step 5: Hooks installieren und Formatierung anwenden**

```bash
pnpm exec lefthook install
pnpm format
```

Expected: `lefthook install` meldet `sync hooks: ✔️ (pre-commit, commit-msg)`. `pnpm format` formatiert vorhandene Markdown-Dateien (Spec, Plan).

- [ ] **Step 6: Negativtest – Secret wird blockiert**

```bash
printf 'token = "ghp_%s"\n' "$(openssl rand -hex 18)" > leak-test.txt
git add leak-test.txt
git commit -m "chore(repo): leak test" ; echo "exit=$?"
git reset -q leak-test.txt && rm leak-test.txt
```

Expected: gitleaks meldet `leaks found: 1`, Ausgabe endet mit `exit=1`, es entsteht **kein** Commit (`git log --oneline -1` zeigt weiterhin den Commit aus Task 1).

- [ ] **Step 7: Negativtest – KI-Attribution und ungültige Messages werden blockiert**

```bash
printf 'docs: test\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\n' | pnpm exec commitlint; echo "exit=$?"
printf 'updated stuff\n' | pnpm exec commitlint; echo "exit=$?"
printf 'feat(unknownscope): x\n' | pnpm exec commitlint; echo "exit=$?"
```

Expected: dreimal `exit=1` mit den Meldungen `no-ai-attribution`, `type-empty`/`subject-empty` und `scope-enum`.

- [ ] **Step 8: Positivtest**

```bash
printf 'feat(repo): add commit hygiene\n' | pnpm exec commitlint; echo "exit=$?"
```

Expected: `exit=0`.

- [ ] **Step 9: Commit**

```bash
git add lefthook.yml .gitleaks.toml commitlint.config.mjs package.json pnpm-lock.yaml pnpm-workspace.yaml docs
git commit -m "chore(repo): add gitleaks, commitlint and prettier hooks"
```

Expected: Beide Hooks laufen grün durch.

---

### Task 3: `@smart/contracts`

**Files:**

- Create: `packages/contracts/package.json`, `packages/contracts/tsconfig.json`, `packages/contracts/tsconfig.build.json`, `packages/contracts/vitest.config.ts`
- Create: `packages/contracts/src/time.ts`, `packages/contracts/src/time.spec.ts`, `packages/contracts/src/health.ts`, `packages/contracts/src/health.spec.ts`, `packages/contracts/src/index.ts`

**Interfaces:**

- Produces (Import aus `@smart/contracts`):
  - `utcInstantSchema: ZodISODateTime` – akzeptiert nur ISO 8601 mit `Z`; `type UtcInstant = string`
  - `localDateSchema` – `YYYY-MM-DD`, gültiges Kalenderdatum; `type LocalDate = string`
  - `healthLiveResponseSchema` – `{ status: 'ok' }`; `type HealthLiveResponse = { status: 'ok' }`
- Paket ist ESM-only, Einstieg `dist/index.js` + `dist/index.d.ts`.

- [ ] **Step 1: `packages/contracts/package.json`**

```json
{
  "name": "@smart/contracts",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "dev": "tsc -p tsconfig.build.json --watch",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "zod": "4.6.5"
  },
  "devDependencies": {
    "@types/node": "24.19.2",
    "typescript": "6.0.3",
    "vitest": "5.0.3"
  }
}
```

- [ ] **Step 2: TypeScript- und Vitest-Konfiguration**

`packages/contracts/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true,
    "outDir": "dist",
    "rootDir": ".",
    "types": ["node"]
  },
  "include": ["src", "vitest.config.ts"]
}
```

`packages/contracts/tsconfig.build.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": "src"
  },
  "include": ["src"],
  "exclude": ["src/**/*.spec.ts"]
}
```

`packages/contracts/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
  },
});
```

Dann: `pnpm install`

- [ ] **Step 3: Failing tests schreiben**

`packages/contracts/src/time.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { localDateSchema, utcInstantSchema } from './time.js';

describe('utcInstantSchema', () => {
  it.each(['2026-10-25T01:30:00Z', '2026-10-25T01:30:00.123Z', '2026-03-29T00:59:59Z'])(
    'accepts the UTC instant %s',
    (value) => {
      expect(utcInstantSchema.safeParse(value).success).toBe(true);
    },
  );

  it.each(['2026-10-25T03:30:00+02:00', '2026-10-25T01:30:00', '2026-10-25', 'not-a-date', ''])(
    'rejects %j because only UTC instants with "Z" are allowed',
    (value) => {
      expect(utcInstantSchema.safeParse(value).success).toBe(false);
    },
  );
});

describe('localDateSchema', () => {
  it.each(['2026-10-25', '2028-02-29'])('accepts the calendar date %s', (value) => {
    expect(localDateSchema.safeParse(value).success).toBe(true);
  });

  it.each(['2026-02-29', '2026-13-01', '2026-04-31', '2026-10-25T00:00:00Z', '25.10.2026'])(
    'rejects %j',
    (value) => {
      expect(localDateSchema.safeParse(value).success).toBe(false);
    },
  );
});
```

`packages/contracts/src/health.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { healthLiveResponseSchema } from './health.js';

describe('healthLiveResponseSchema', () => {
  it('accepts { status: "ok" }', () => {
    expect(healthLiveResponseSchema.parse({ status: 'ok' })).toEqual({ status: 'ok' });
  });

  it.each([{ status: 'down' }, {}, null])('rejects %j', (value) => {
    expect(healthLiveResponseSchema.safeParse(value).success).toBe(false);
  });
});
```

- [ ] **Step 4: Tests laufen lassen – müssen fehlschlagen**

Run: `pnpm --filter @smart/contracts test`
Expected: FAIL, `Cannot find module './time.js'` bzw. `'./health.js'`.

- [ ] **Step 5: Implementierung**

`packages/contracts/src/time.ts`:

```ts
import { z } from 'zod';

/**
 * A point in time, transported as ISO 8601 in UTC with a trailing `Z`
 * (e.g. `2026-10-25T01:30:00Z`). Offsets and zone-less values are rejected.
 */
export const utcInstantSchema = z.iso.datetime();
export type UtcInstant = z.infer<typeof utcInstantSchema>;

/**
 * A calendar date without time or zone (`YYYY-MM-DD`).
 * Never convert it to a `Date`: that would shift it by the runtime's offset.
 */
export const localDateSchema = z.iso.date().refine(isExistingCalendarDate, {
  message: 'Invalid calendar date',
});
export type LocalDate = z.infer<typeof localDateSchema>;

function isExistingCalendarDate(value: string): boolean {
  const [year = Number.NaN, month = Number.NaN, day = Number.NaN] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}
```

`packages/contracts/src/health.ts`:

```ts
import { z } from 'zod';

export const healthLiveResponseSchema = z.object({
  status: z.literal('ok'),
});
export type HealthLiveResponse = z.infer<typeof healthLiveResponseSchema>;
```

`packages/contracts/src/index.ts`:

```ts
export * from './health.js';
export * from './time.js';
```

- [ ] **Step 6: Tests laufen lassen – müssen bestehen**

Run: `pnpm --filter @smart/contracts test`
Expected: PASS (alle Fälle grün).

- [ ] **Step 7: Zeitzonen-Unabhängigkeit prüfen**

Run: `TZ=Pacific/Chatham pnpm --filter @smart/contracts test && TZ=America/Los_Angeles pnpm --filter @smart/contracts test`
Expected: PASS in beiden Zeitzonen.

- [ ] **Step 8: Frischer-Clone-Szenario (Review Focus 1)**

```bash
rm -rf packages/contracts/dist
pnpm install
test -f packages/contracts/dist/index.js && test -f packages/contracts/dist/index.d.ts && echo "contracts built by prepare"
pnpm --filter @smart/contracts typecheck
```

Expected: `contracts built by prepare`, Typecheck ohne Fehler. `dist/` enthält keine `*.spec.*`-Dateien (`ls packages/contracts/dist`).

- [ ] **Step 9: Commit**

```bash
git add packages/contracts pnpm-lock.yaml
git commit -m "feat(contracts): add time and health schemas"
```

---

### Task 4: Backend-Gerüst mit Health-Endpoint

**Files:**

- Create (generiert, dann angepasst): `apps/backend/**`
- Create: `apps/backend/src/app.setup.ts`, `apps/backend/src/platform/observability/health.controller.ts`, `apps/backend/src/platform/observability/observability.module.ts`, `apps/backend/src/platform/observability/index.ts`, `apps/backend/src/core/README.md`, `apps/backend/src/modules/README.md`, `apps/backend/test/health.e2e-spec.ts`
- Modify: `apps/backend/src/main.ts`, `apps/backend/src/app.module.ts`, `apps/backend/package.json`
- Delete: `apps/backend/src/app.controller.ts`, `app.controller.spec.ts`, `app.service.ts`, `apps/backend/test/app.e2e-spec.ts`, `apps/backend/.oxlintrc.json`, `apps/backend/.prettierrc`, `apps/backend/README.md`

**Interfaces:**

- Consumes: `healthLiveResponseSchema`, `type HealthLiveResponse` aus `@smart/contracts`.
- Produces: `configureApp(app: INestApplication): void` (setzt globales Präfix `api`, Shutdown-Hooks); `ObservabilityModule`; Route `GET /api/health/live` → `200 { "status": "ok" }`.

- [ ] **Step 1: Projekt generieren**

```bash
pnpm dlx @nestjs/cli@12.0.8 new backend --directory apps/backend --package-manager pnpm --skip-git --skip-install --strict --type esm
```

Expected: `apps/backend/` mit `package.json` (`"type": "module"`), `vitest.config.ts`, `vitest.config.e2e.ts`, `src/`, `test/`.

- [ ] **Step 2: Generierte Beispieldateien und Fremd-Tooling entfernen**

```bash
cd apps/backend
rm -f src/app.controller.ts src/app.controller.spec.ts src/app.service.ts test/app.e2e-spec.ts .oxlintrc.json .prettierrc README.md
cd ../..
```

- [ ] **Step 3: `apps/backend/package.json` anpassen**

`name` → `"@smart/backend"`, `version` → `"0.0.0"`, `license` entfernen. Den `scripts`-Block vollständig ersetzen durch:

```json
"scripts": {
  "build": "nest build",
  "start:dev": "nest start --watch",
  "start:prod": "node dist/main.js",
  "typecheck": "tsc -p tsconfig.json --noEmit",
  "test": "vitest run && vitest run --config vitest.config.e2e.ts"
}
```

Aus `devDependencies` entfernen: `oxlint`, `oxlint-tsgolint`, `prettier`, `@nestjs/mau`. `typescript` auf exakt `"6.0.3"` setzen. In `dependencies` ergänzen: `"@smart/contracts": "workspace:*"`. Dann `pnpm install`.

- [ ] **Step 4: Failing e2e-Test schreiben**

`apps/backend/test/health.e2e-spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { healthLiveResponseSchema } from '@smart/contracts';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';

describe('GET /api/health/live', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports the process as live', async () => {
    const response = await request(app.getHttpServer()).get('/api/health/live').expect(200);
    expect(healthLiveResponseSchema.parse(response.body)).toEqual({ status: 'ok' });
  });

  it('serves nothing outside the /api prefix', async () => {
    await request(app.getHttpServer()).get('/health/live').expect(404);
  });
});
```

- [ ] **Step 5: Test laufen lassen – muss fehlschlagen**

Run: `pnpm --filter @smart/backend exec vitest run --config vitest.config.e2e.ts`
Expected: FAIL, `Cannot find module '../src/app.setup.js'`.

- [ ] **Step 6: Implementierung**

`apps/backend/src/app.setup.ts`:

```ts
import type { INestApplication } from '@nestjs/common';

/** Shared HTTP setup for main.ts and e2e tests, so both serve identical routes. */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
}
```

`apps/backend/src/platform/observability/health.controller.ts`:

```ts
import { Controller, Get } from '@nestjs/common';
import type { HealthLiveResponse } from '@smart/contracts';

@Controller('health')
export class HealthController {
  @Get('live')
  live(): HealthLiveResponse {
    return { status: 'ok' };
  }
}
```

`apps/backend/src/platform/observability/observability.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';

@Module({
  controllers: [HealthController],
})
export class ObservabilityModule {}
```

`apps/backend/src/platform/observability/index.ts`:

```ts
export { ObservabilityModule } from './observability.module.js';
```

`apps/backend/src/app.module.ts` (vollständig ersetzen):

```ts
import { Module } from '@nestjs/common';
import { ObservabilityModule } from './platform/observability/index.js';

@Module({
  imports: [ObservabilityModule],
})
export class AppModule {}
```

`apps/backend/src/main.ts` (vollständig ersetzen):

```ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';

const app = await NestFactory.create(AppModule);
configureApp(app);
await app.listen(Number(process.env.PORT ?? 3000));
```

- [ ] **Step 7: Test laufen lassen – muss bestehen**

Run: `pnpm --filter @smart/backend exec vitest run --config vitest.config.e2e.ts`
Expected: PASS (2 Tests).

Schlägt der Test mit `Nest can't resolve dependencies` fehl (fehlende Decorator-Metadaten im Vitest-Transform), `unplugin-swc@2.0.0` und `@swc/core@1.16.18` als devDependencies ergänzen und in beiden Vitest-Configs `plugins: [tsconfigPaths(), swc.vite({ module: { type: 'es6' } })]` (Import `import swc from 'unplugin-swc';`) eintragen, dann erneut ausführen.

- [ ] **Step 8: Ordner-Konventionen dokumentieren**

`apps/backend/src/core/README.md`:

```md
# core

Device-type-agnostic domain kernel (identity, households, gateways, devices, telemetry, commands, notifications).

- One folder per core module; other folders import it only through its `index.ts`.
- Core never imports from `modules/`.
- Enforced by `boundaries/dependencies` (see `tools/lint-config`).
```

`apps/backend/src/modules/README.md`:

```md
# modules

Feature modules (e.g. `plants`, `heating`). Each owns its tables (`*.schema.ts`, table prefix = module name), logic and API.

- May use `core/*` and `platform/*` through their `index.ts`.
- Must never import another feature module; react to core domain events instead.
- Enforced by `boundaries/dependencies` (see `tools/lint-config`).
```

- [ ] **Step 9: Gesamtprüfung Backend**

Run:

```bash
pnpm --filter @smart/backend typecheck && pnpm --filter @smart/backend test && pnpm --filter @smart/backend build
node apps/backend/dist/main.js & sleep 2; curl -s localhost:3000/api/health/live; kill %1
```

Expected: alle drei Befehle grün; `curl` gibt `{"status":"ok"}` aus.

- [ ] **Step 10: Formatieren und committen**

```bash
pnpm format
git add apps/backend pnpm-lock.yaml
git commit -m "feat(backend): scaffold NestJS app with live health endpoint"
```

---

### Task 5: Frontend-Gerüst

**Files:**

- Create (generiert, dann angepasst): `apps/frontend/**`
- Modify: `apps/frontend/src/app/app.ts`, `apps/frontend/src/app/app.spec.ts`, `apps/frontend/package.json`
- Create: `apps/frontend/src/app/core/contracts-wiring.spec.ts`
- Delete: `apps/frontend/src/app/app.html`, `apps/frontend/src/app/app.scss`, `apps/frontend/.gitignore`, `apps/frontend/.editorconfig`, `apps/frontend/.vscode/`, `apps/frontend/README.md`, eine eventuell generierte Prettier-Konfiguration in `apps/frontend`

**Interfaces:**

- Consumes: `utcInstantSchema` aus `@smart/contracts`.
- Produces: Root-Komponente `App` (Selector `app-root`, nur `<router-outlet />`, keine Styles); Skripte `build`, `test`, `typecheck`.
- Die UI-Bibliothek `@smart/ui` wird erst in Etappe 3 generiert. Die Lint-Regeln aus Task 6 sind darauf bereits vorbereitet.

- [ ] **Step 1: Workspace generieren**

```bash
pnpm dlx @angular/cli@22.2.2 new frontend --directory apps/frontend --style scss --ssr false --zoneless true --routing true --skip-git --skip-install --package-manager pnpm --ai-config none --test-runner vitest --strict
```

Lehnt die CLI eine Option ab: `pnpm dlx @angular/cli@22.2.2 new --help` lesen, nur diese Option weglassen, erneut ausführen.

- [ ] **Step 2: Doppelte Konfiguration entfernen**

```bash
cd apps/frontend
rm -rf .gitignore .editorconfig .vscode README.md .prettierrc .prettierrc.json src/app/app.html src/app/app.scss
cd ../..
```

Steht in `apps/frontend/package.json` ein `prettier`-Schlüssel, diesen entfernen.

- [ ] **Step 3: `apps/frontend/package.json` anpassen**

`name` → `"@smart/frontend"`, `version` → `"0.0.0"`. `scripts` vollständig ersetzen durch:

```json
"scripts": {
  "start": "ng serve",
  "build": "ng build",
  "test": "ng test --watch=false",
  "typecheck": "tsc -p tsconfig.app.json --noEmit && tsc -p tsconfig.spec.json --noEmit"
}
```

`typescript` in `devDependencies` auf exakt `"6.0.3"`. In `dependencies` ergänzen: `"@smart/contracts": "workspace:*"`. Dann `pnpm install`.

- [ ] **Step 4: Failing tests schreiben**

`apps/frontend/src/app/app.spec.ts` (vollständig ersetzen):

```ts
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  it('renders nothing but the router outlet', () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('router-outlet')).not.toBeNull();
    expect(host.children.length).toBe(1);
  });
});
```

`apps/frontend/src/app/core/contracts-wiring.spec.ts`:

```ts
import { utcInstantSchema } from '@smart/contracts';

describe('@smart/contracts wiring', () => {
  it('is resolvable from the frontend test build', () => {
    expect(utcInstantSchema.safeParse('2026-10-25T01:30:00Z').success).toBe(true);
    expect(utcInstantSchema.safeParse('2026-10-25T03:30:00+02:00').success).toBe(false);
  });
});
```

- [ ] **Step 5: Tests laufen lassen – müssen fehlschlagen**

Run: `pnpm --filter @smart/frontend test`
Expected: FAIL, weil `app.ts` noch auf die gelöschte `app.html`/`app.scss` verweist bzw. das generierte Template mehr als ein Element rendert.

- [ ] **Step 6: Root-Komponente implementieren**

`apps/frontend/src/app/app.ts` (vollständig ersetzen):

```ts
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: '<router-outlet />',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {}
```

- [ ] **Step 7: Tests laufen lassen – müssen bestehen**

Run: `pnpm --filter @smart/frontend test`
Expected: PASS (2 Tests).

- [ ] **Step 8: Gesamtprüfung Frontend**

Run: `pnpm --filter @smart/frontend typecheck && pnpm --filter @smart/frontend build && TZ=Pacific/Chatham pnpm --filter @smart/frontend test`
Expected: alles grün; `apps/frontend/dist/frontend/browser/index.html` existiert.

- [ ] **Step 9: Formatieren und committen**

```bash
pnpm format
git add apps/frontend pnpm-lock.yaml
git commit -m "feat(frontend): scaffold zoneless Angular app"
```

---

### Task 6: Architekturregeln als Lint-Konfiguration

**Files:**

- Create: `tools/lint-config/package.json`, `tools/lint-config/vitest.config.mjs`
- Create: `tools/lint-config/eslint/index.mjs`, `eslint/plugin.mjs`, `eslint/backend-boundaries.mjs`, `eslint/frontend-boundaries.mjs`, `eslint/frontend-restricted-imports.mjs`, `eslint/rules/no-component-styles.mjs`
- Create: `tools/lint-config/stylelint/index.mjs`
- Create: `tools/lint-config/test/no-component-styles.spec.mjs`, `test/eslint-architecture.spec.mjs`, `test/stylelint.spec.mjs`, Fixture-Dateien unter `test/fixture/` (Liste in Step 5)
- Create: `eslint.config.mjs`, `stylelint.config.mjs`
- Modify: `package.json` (devDependencies), `lefthook.yml` (eslint-Hook)

**Interfaces:**

- Produces:
  - `@smart/lint-config/eslint` → `smartConfig({ rootDir: string, typeChecked?: boolean }): ConfigWithExtends[]`
  - `@smart/lint-config/stylelint` → Stylelint-Config-Objekt (default export)
  - ESLint-Regel `smart/no-component-styles` mit Option `{ allowStyleUrl?: boolean }`
  - Element-Typen: Backend `be-platform`, `be-core`, `be-module`, `be-app`; Frontend `fe-core`, `fe-shell`, `fe-feature`, `fe-app`

- [ ] **Step 1: Paket anlegen**

`tools/lint-config/package.json`:

```json
{
  "name": "@smart/lint-config",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    "./eslint": "./eslint/index.mjs",
    "./stylelint": "./stylelint/index.mjs"
  },
  "scripts": {
    "test": "vitest run"
  },
  "dependencies": {
    "@eslint/js": "10.0.1",
    "angular-eslint": "22.5.0",
    "eslint-import-resolver-typescript": "4.4.4",
    "eslint-plugin-boundaries": "7.2.0",
    "stylelint-config-standard-scss": "16.0.0",
    "stylelint-declaration-strict-value": "1.12.1",
    "typescript-eslint": "8.71.1"
  },
  "devDependencies": {
    "eslint": "10.12.0",
    "stylelint": "17.16.0",
    "typescript": "6.0.3",
    "vitest": "5.0.3"
  }
}
```

Vor `pnpm install` die genannten Versionen von `@eslint/js`, `eslint-import-resolver-typescript` und `stylelint-config-standard-scss` mit `npm view <paket> version` prüfen und auf die jeweils aktuelle Version setzen, deren `peerDependencies` zu ESLint 10 bzw. Stylelint 17 passen (`npm view <paket> peerDependencies`).

`tools/lint-config/vitest.config.mjs`:

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['test/**/*.spec.mjs'],
    testTimeout: 30_000,
  },
});
```

Root-devDependencies ergänzen und installieren:

```bash
pnpm add -Dw eslint@10.12.0 stylelint@17.16.0 typescript@6.0.3 "@smart/lint-config@workspace:*"
pnpm install
```

- [ ] **Step 2: Failing RuleTester-Test für `no-component-styles`**

`tools/lint-config/test/no-component-styles.spec.mjs`:

```js
import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { noComponentStyles } from '../eslint/rules/no-component-styles.mjs';

const ruleTester = new RuleTester({ languageOptions: { parser: tseslint.parser } });

ruleTester.run('no-component-styles', noComponentStyles, {
  valid: [
    { code: "@Component({ selector: 'app-x', template: '' }) class X {}" },
    {
      code: "@Component({ selector: 'ui-x', template: '', styleUrl: './x.scss' }) class X {}",
      options: [{ allowStyleUrl: true }],
    },
    { code: "@Directive({ selector: '[appX]', styles: [] }) class X {}" },
  ],
  invalid: [
    {
      code: "@Component({ selector: 'app-x', template: '', styles: [':host{}'] }) class X {}",
      errors: [{ messageId: 'noStyles', data: { name: 'styles' } }],
    },
    {
      code: "@Component({ selector: 'app-x', template: '', styleUrl: './x.scss' }) class X {}",
      errors: [{ messageId: 'noStyles', data: { name: 'styleUrl' } }],
    },
    {
      code: "@Component({ selector: 'app-x', template: '', styleUrls: ['./x.scss'] }) class X {}",
      errors: [{ messageId: 'noStyles', data: { name: 'styleUrls' } }],
    },
    {
      code: "@Component({ selector: 'ui-x', template: '', styles: ':host{}' }) class X {}",
      options: [{ allowStyleUrl: true }],
      errors: [{ messageId: 'noStyles', data: { name: 'styles' } }],
    },
  ],
});
```

Run: `pnpm --filter @smart/lint-config test`
Expected: FAIL, `Cannot find module '../eslint/rules/no-component-styles.mjs'`.

- [ ] **Step 3: Regel implementieren**

`tools/lint-config/eslint/rules/no-component-styles.mjs`:

```js
/** Components outside @smart/ui must not style themselves; @smart/ui may only use style files. */
export const noComponentStyles = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow component-level styles. Build UI from @smart/ui; add a ui-* component if something is missing.',
    },
    schema: [
      {
        type: 'object',
        properties: { allowStyleUrl: { type: 'boolean' } },
        additionalProperties: false,
      },
    ],
    messages: {
      noStyles:
        'Components here must not define "{{name}}". Use @smart/ui components and layout primitives instead.',
    },
  },
  create(context) {
    const allowStyleUrl = context.options[0]?.allowStyleUrl ?? false;
    const banned = new Set(allowStyleUrl ? ['styles'] : ['styles', 'styleUrl', 'styleUrls']);

    return {
      'Decorator > CallExpression[callee.name="Component"] > ObjectExpression > Property'(node) {
        const name =
          node.key.type === 'Identifier'
            ? node.key.name
            : node.key.type === 'Literal'
              ? String(node.key.value)
              : undefined;
        if (name !== undefined && banned.has(name)) {
          context.report({ node, messageId: 'noStyles', data: { name } });
        }
      },
    };
  },
};
```

`tools/lint-config/eslint/plugin.mjs`:

```js
import { noComponentStyles } from './rules/no-component-styles.mjs';

export const smartPlugin = {
  meta: { name: '@smart/eslint-plugin' },
  rules: {
    'no-component-styles': noComponentStyles,
  },
};
```

Run: `pnpm --filter @smart/lint-config test`
Expected: PASS.

- [ ] **Step 4: Failing Architektur-Tests schreiben**

`tools/lint-config/test/eslint-architecture.spec.mjs`:

```js
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { defineConfig } from 'eslint/config';
import { describe, expect, it } from 'vitest';
import { smartConfig } from '../eslint/index.mjs';

const fixtureRoot = fileURLToPath(new URL('./fixture/', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const ARCHITECTURE_RULES = [
  'boundaries/dependencies',
  'no-restricted-imports',
  'smart/no-component-styles',
];

const fixtureLinter = new ESLint({
  cwd: fixtureRoot,
  overrideConfigFile: true,
  overrideConfig: defineConfig(smartConfig({ rootDir: fixtureRoot, typeChecked: false })),
});

async function violations(linter, root, relativePath, code) {
  const [result] = await linter.lintText(code, { filePath: path.join(root, relativePath) });
  const fatal = result.messages.filter((m) => m.fatal);
  if (fatal.length > 0) throw new Error(fatal.map((m) => m.message).join('\n'));
  return result.messages.map((m) => m.ruleId).filter((id) => ARCHITECTURE_RULES.includes(id));
}

const lintFixture = (relativePath, code) =>
  violations(fixtureLinter, fixtureRoot, relativePath, code);

describe('backend boundaries', () => {
  const cases = [
    [
      'core → other core via index',
      'apps/backend/src/core/devices/devices.service.ts',
      "import { t } from '../telemetry/index.js';\nexport const d = t;",
      [],
    ],
    [
      'core → other core internals',
      'apps/backend/src/core/devices/devices.service.ts',
      "import { r } from '../telemetry/telemetry.repository.js';\nexport const d = r;",
      ['boundaries/dependencies'],
    ],
    [
      'core → feature module',
      'apps/backend/src/core/devices/devices.service.ts',
      "import { p } from '../../modules/plants/index.js';\nexport const d = p;",
      ['boundaries/dependencies'],
    ],
    [
      'platform → core',
      'apps/backend/src/platform/database/database.service.ts',
      "import { d } from '../../core/devices/index.js';\nexport const x = d;",
      ['boundaries/dependencies'],
    ],
    [
      'module → other module',
      'apps/backend/src/modules/plants/plants.service.ts',
      "import { h } from '../heating/index.js';\nexport const x = h;",
      ['boundaries/dependencies'],
    ],
    [
      'module → core via index',
      'apps/backend/src/modules/plants/plants.service.ts',
      "import { d } from '../../core/devices/index.js';\nexport const x = d;",
      [],
    ],
    [
      'module → own internals',
      'apps/backend/src/modules/plants/plants.service.ts',
      "import { r } from './plants.repository.js';\nexport const x = r;",
      [],
    ],
    [
      'app root → core internals',
      'apps/backend/src/app.module.ts',
      "import { s } from './core/devices/devices.service.js';\nexport const x = s;",
      ['boundaries/dependencies'],
    ],
    [
      'app root → core via index',
      'apps/backend/src/app.module.ts',
      "import { d } from './core/devices/index.js';\nexport const x = d;",
      [],
    ],
  ];

  it.each(cases)('%s', async (_name, file, code, expected) => {
    expect(await lintFixture(file, code)).toEqual(expected);
  });
});

describe('frontend boundaries and UI rules', () => {
  const page = (imports) =>
    `${imports}\nimport { Component } from '@angular/core';\n@Component({ selector: 'app-devices-page', template: '' })\nexport class DevicesPage {}\n`;

  const cases = [
    [
      'feature → Angular Material',
      'apps/frontend/src/app/features/devices/devices.page.ts',
      page("import { MatButton } from '@angular/material/button';\nexport const b = MatButton;"),
      ['no-restricted-imports'],
    ],
    [
      'feature → CDK',
      'apps/frontend/src/app/features/devices/devices.page.ts',
      page("import { Overlay } from '@angular/cdk/overlay';\nexport const o = Overlay;"),
      ['no-restricted-imports'],
    ],
    [
      'feature → @smart/ui public API',
      'apps/frontend/src/app/features/devices/devices.page.ts',
      page("import { x } from '@smart/ui';\nexport const u = x;"),
      [],
    ],
    [
      'feature → @smart/ui internals',
      'apps/frontend/src/app/features/devices/devices.page.ts',
      page("import { x } from '@smart/ui/src/lib/button';\nexport const u = x;"),
      ['no-restricted-imports'],
    ],
    [
      'feature → DatePipe',
      'apps/frontend/src/app/features/devices/devices.page.ts',
      page("import { DatePipe } from '@angular/common';\nexport const p = DatePipe;"),
      ['no-restricted-imports'],
    ],
    [
      'feature → allowed @angular/common symbol',
      'apps/frontend/src/app/features/devices/devices.page.ts',
      page(
        "import { NgTemplateOutlet } from '@angular/common';\nexport const p = NgTemplateOutlet;",
      ),
      [],
    ],
    [
      'feature → other feature',
      'apps/frontend/src/app/features/devices/devices.page.ts',
      page("import { plants } from '../plants';\nexport const p = plants;"),
      ['boundaries/dependencies'],
    ],
    [
      'feature → core via index',
      'apps/frontend/src/app/features/devices/devices.page.ts',
      page("import { auth } from '../../core/auth';\nexport const a = auth;"),
      [],
    ],
    [
      'feature → core internals',
      'apps/frontend/src/app/features/devices/devices.page.ts',
      page(
        "import { AuthService } from '../../core/auth/auth.service';\nexport const a = AuthService;",
      ),
      ['boundaries/dependencies'],
    ],
    [
      'core → feature',
      'apps/frontend/src/app/core/auth/auth.service.ts',
      "import { devices } from '../../features/devices';\nexport const d = devices;",
      ['boundaries/dependencies'],
    ],
    [
      'shell → feature',
      'apps/frontend/src/app/shell/shell.ts',
      "import { devices } from '../features/devices';\nexport const d = devices;",
      ['boundaries/dependencies'],
    ],
    [
      'ui library → Angular Material',
      'apps/frontend/projects/ui/src/lib/button.ts',
      "import { MatButton } from '@angular/material/button';\nexport const b = MatButton;",
      [],
    ],
    [
      'feature component with styles',
      'apps/frontend/src/app/features/devices/devices.page.ts',
      "import { Component } from '@angular/core';\n@Component({ selector: 'app-devices-page', template: '', styles: [':host{}'] })\nexport class DevicesPage {}\n",
      ['smart/no-component-styles'],
    ],
    [
      'feature component with styleUrl',
      'apps/frontend/src/app/features/devices/devices.page.ts',
      "import { Component } from '@angular/core';\n@Component({ selector: 'app-devices-page', template: '', styleUrl: './x.scss' })\nexport class DevicesPage {}\n",
      ['smart/no-component-styles'],
    ],
    [
      'ui component with styleUrl',
      'apps/frontend/projects/ui/src/lib/button.ts',
      "import { Component } from '@angular/core';\n@Component({ selector: 'ui-button', template: '', styleUrl: './button.scss' })\nexport class UiButton {}\n",
      [],
    ],
    [
      'ui component with inline styles',
      'apps/frontend/projects/ui/src/lib/button.ts',
      "import { Component } from '@angular/core';\n@Component({ selector: 'ui-button', template: '', styles: [':host{}'] })\nexport class UiButton {}\n",
      ['smart/no-component-styles'],
    ],
  ];

  it.each(cases)('%s', async (_name, file, code, expected) => {
    expect(await lintFixture(file, code)).toEqual(expected);
  });
});

describe('root eslint.config.mjs (canary against real repository paths)', () => {
  const rootLinter = new ESLint({ cwd: repoRoot });

  it('blocks Angular Material in a real feature path', async () => {
    const result = await violations(
      rootLinter,
      repoRoot,
      'apps/frontend/src/app/features/canary/canary.page.ts',
      "import { MatButton } from '@angular/material/button';\nexport const b = MatButton;\n",
    );
    expect(result).toEqual(['no-restricted-imports']);
  });

  it('blocks component styles in the real app root folder', async () => {
    const result = await violations(
      rootLinter,
      repoRoot,
      'apps/frontend/src/app/canary.ts',
      "import { Component } from '@angular/core';\n@Component({ selector: 'app-canary', template: '', styles: [':host{}'] })\nexport class Canary {}\n",
    );
    expect(result).toEqual(['smart/no-component-styles']);
  });
});
```

- [ ] **Step 5: Fixture-Dateien anlegen**

Jede der folgenden Dateien enthält genau eine Zeile `export const x = 1;` – nur ihre Existenz zählt (der Resolver muss die Importziele finden):

```
tools/lint-config/test/fixture/apps/backend/src/app.module.ts
tools/lint-config/test/fixture/apps/backend/src/core/devices/index.ts
tools/lint-config/test/fixture/apps/backend/src/core/devices/devices.service.ts
tools/lint-config/test/fixture/apps/backend/src/core/telemetry/index.ts
tools/lint-config/test/fixture/apps/backend/src/core/telemetry/telemetry.repository.ts
tools/lint-config/test/fixture/apps/backend/src/platform/database/index.ts
tools/lint-config/test/fixture/apps/backend/src/platform/database/database.service.ts
tools/lint-config/test/fixture/apps/backend/src/modules/plants/index.ts
tools/lint-config/test/fixture/apps/backend/src/modules/plants/plants.service.ts
tools/lint-config/test/fixture/apps/backend/src/modules/plants/plants.repository.ts
tools/lint-config/test/fixture/apps/backend/src/modules/heating/index.ts
tools/lint-config/test/fixture/apps/frontend/src/app/core/auth/index.ts
tools/lint-config/test/fixture/apps/frontend/src/app/core/auth/auth.service.ts
tools/lint-config/test/fixture/apps/frontend/src/app/shell/shell.ts
tools/lint-config/test/fixture/apps/frontend/src/app/features/devices/index.ts
tools/lint-config/test/fixture/apps/frontend/src/app/features/devices/devices.page.ts
tools/lint-config/test/fixture/apps/frontend/src/app/features/plants/index.ts
tools/lint-config/test/fixture/apps/frontend/projects/ui/src/lib/button.ts
```

```bash
cd tools/lint-config/test/fixture
for f in apps/backend/src/app.module.ts apps/backend/src/core/devices/index.ts apps/backend/src/core/devices/devices.service.ts apps/backend/src/core/telemetry/index.ts apps/backend/src/core/telemetry/telemetry.repository.ts apps/backend/src/platform/database/index.ts apps/backend/src/platform/database/database.service.ts apps/backend/src/modules/plants/index.ts apps/backend/src/modules/plants/plants.service.ts apps/backend/src/modules/plants/plants.repository.ts apps/backend/src/modules/heating/index.ts apps/frontend/src/app/core/auth/index.ts apps/frontend/src/app/core/auth/auth.service.ts apps/frontend/src/app/shell/shell.ts apps/frontend/src/app/features/devices/index.ts apps/frontend/src/app/features/devices/devices.page.ts apps/frontend/src/app/features/plants/index.ts apps/frontend/projects/ui/src/lib/button.ts; do mkdir -p "$(dirname "$f")"; echo 'export const x = 1;' > "$f"; done
cd -
```

`tools/lint-config/test/fixture/tsconfig.json`:

```json
{
  "compilerOptions": {
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "strict": true,
    "noEmit": true
  },
  "include": ["apps/**/*.ts"]
}
```

Run: `pnpm --filter @smart/lint-config test`
Expected: FAIL, `Cannot find module '../eslint/index.mjs'`.

- [ ] **Step 6: ESLint-Konfiguration implementieren**

`tools/lint-config/eslint/backend-boundaries.mjs`:

```js
import boundaries from 'eslint-plugin-boundaries';

const NOT_INTERNAL = { relationship: { to: '!internal' } };

export function backendBoundaries() {
  return {
    files: ['apps/backend/src/**/*.ts'],
    plugins: { boundaries },
    settings: {
      'import/resolver': { typescript: { alwaysTryTypes: true } },
      'boundaries/elements': [
        { type: 'be-platform', pattern: 'apps/backend/src/platform/*', capture: ['name'] },
        { type: 'be-core', pattern: 'apps/backend/src/core/*', capture: ['name'] },
        { type: 'be-module', pattern: 'apps/backend/src/modules/*', capture: ['name'] },
        { type: 'be-app', pattern: 'apps/backend/src' },
      ],
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'allow',
          policies: [
            {
              disallow: {
                to: {
                  element: {
                    type: ['be-platform', 'be-core', 'be-module'],
                    fileInternalPath: '!index.ts',
                  },
                },
                dependency: NOT_INTERNAL,
              },
              message: 'Import "{{to.element.captured.name}}" only through its public index.ts',
            },
            {
              from: { element: { type: 'be-platform' } },
              disallow: { to: { element: { type: ['be-core', 'be-module'] } } },
              message: 'platform/* must not depend on core/* or modules/*',
            },
            {
              from: { element: { type: 'be-core' } },
              disallow: { to: { element: { type: 'be-module' } } },
              message: 'core/* must not depend on feature modules',
            },
            {
              from: { element: { type: 'be-module' } },
              disallow: { to: { element: { type: 'be-module' } }, dependency: NOT_INTERNAL },
              message: 'Feature modules must not depend on each other; use core domain events',
            },
          ],
        },
      ],
    },
  };
}
```

`tools/lint-config/eslint/frontend-boundaries.mjs`:

```js
import boundaries from 'eslint-plugin-boundaries';

const NOT_INTERNAL = { relationship: { to: '!internal' } };

export function frontendBoundaries() {
  return {
    files: ['apps/frontend/src/**/*.ts'],
    plugins: { boundaries },
    settings: {
      'import/resolver': { typescript: { alwaysTryTypes: true } },
      'boundaries/elements': [
        { type: 'fe-core', pattern: 'apps/frontend/src/app/core/*', capture: ['name'] },
        { type: 'fe-shell', pattern: 'apps/frontend/src/app/shell' },
        { type: 'fe-feature', pattern: 'apps/frontend/src/app/features/*', capture: ['name'] },
        { type: 'fe-app', pattern: 'apps/frontend/src' },
      ],
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'allow',
          policies: [
            {
              disallow: {
                to: {
                  element: { type: ['fe-core', 'fe-feature'], fileInternalPath: '!index.ts' },
                },
                dependency: NOT_INTERNAL,
              },
              message: 'Import "{{to.element.captured.name}}" only through its public index.ts',
            },
            {
              from: { element: { type: ['fe-core', 'fe-shell'] } },
              disallow: { to: { element: { type: 'fe-feature' } } },
              message:
                'core/ and shell/ must not depend on features; features register via provideFeature()',
            },
            {
              from: { element: { type: 'fe-feature' } },
              disallow: { to: { element: { type: 'fe-feature' } }, dependency: NOT_INTERNAL },
              message: 'Features must not depend on each other',
            },
          ],
        },
      ],
    },
  };
}
```

`tools/lint-config/eslint/frontend-restricted-imports.mjs`:

```js
const PUBLIC_UI_ONLY = 'Import from the public API "@smart/ui" only.';

export function frontendRestrictedImports() {
  return {
    files: ['apps/frontend/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@angular/common',
              importNames: ['DatePipe', 'CommonModule', 'formatDate'],
              message: 'Use the time-zone-aware pipes from @smart/ui (spec §9).',
            },
          ],
          patterns: [
            {
              group: ['@angular/material', '@angular/material/*', '@angular/cdk', '@angular/cdk/*'],
              message:
                'Angular Material/CDK are internal to @smart/ui. Use or add a ui-* component.',
            },
            { group: ['@smart/ui/*'], message: PUBLIC_UI_ONLY },
            { group: ['**/projects/ui/**'], message: PUBLIC_UI_ONLY },
          ],
        },
      ],
    },
  };
}
```

`tools/lint-config/eslint/index.mjs`:

```js
import js from '@eslint/js';
import angular from 'angular-eslint';
import tseslint from 'typescript-eslint';
import { backendBoundaries } from './backend-boundaries.mjs';
import { frontendBoundaries } from './frontend-boundaries.mjs';
import { frontendRestrictedImports } from './frontend-restricted-imports.mjs';
import { smartPlugin } from './plugin.mjs';

/**
 * Complete ESLint flat config for the monorepo. Wrap with `defineConfig()`.
 * @param {{ rootDir: string, typeChecked?: boolean }} options
 */
export function smartConfig({ rootDir, typeChecked = true }) {
  return [
    {
      ignores: [
        '**/dist/**',
        '**/coverage/**',
        '**/.angular/**',
        '**/node_modules/**',
        'tools/lint-config/test/fixture/**',
      ],
    },
    { files: ['**/*.{js,mjs,cjs,ts}'], extends: [js.configs.recommended] },
    { files: ['**/*.ts'], extends: [tseslint.configs.recommended] },
    ...(typeChecked
      ? [
          {
            files: ['apps/backend/**/*.ts', 'packages/**/*.ts'],
            extends: [tseslint.configs.recommendedTypeChecked],
            languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: rootDir } },
          },
        ]
      : []),
    {
      files: ['apps/frontend/**/*.ts'],
      extends: [angular.configs.tsRecommended],
      processor: angular.processInlineTemplates,
      rules: {
        '@angular-eslint/prefer-on-push-component-change-detection': 'error',
      },
    },
    {
      files: ['apps/frontend/src/**/*.ts'],
      rules: {
        '@angular-eslint/component-selector': [
          'error',
          { type: 'element', prefix: 'app', style: 'kebab-case' },
        ],
        '@angular-eslint/directive-selector': [
          'error',
          { type: 'attribute', prefix: 'app', style: 'camelCase' },
        ],
      },
    },
    {
      files: ['apps/frontend/projects/ui/**/*.ts'],
      rules: {
        '@angular-eslint/component-selector': [
          'error',
          { type: 'element', prefix: 'ui', style: 'kebab-case' },
        ],
        '@angular-eslint/directive-selector': [
          'error',
          { type: 'attribute', prefix: 'ui', style: 'camelCase' },
        ],
      },
    },
    {
      files: ['apps/frontend/**/*.html'],
      extends: [angular.configs.templateRecommended, angular.configs.templateAccessibility],
    },
    {
      files: ['apps/frontend/src/app/**/*.ts'],
      plugins: { smart: smartPlugin },
      rules: { 'smart/no-component-styles': 'error' },
    },
    {
      files: ['apps/frontend/projects/ui/**/*.ts'],
      plugins: { smart: smartPlugin },
      rules: { 'smart/no-component-styles': ['error', { allowStyleUrl: true }] },
    },
    frontendRestrictedImports(),
    backendBoundaries(),
    frontendBoundaries(),
  ];
}
```

`eslint.config.mjs` (Repo-Root):

```js
import { defineConfig } from 'eslint/config';
import { smartConfig } from '@smart/lint-config/eslint';

export default defineConfig(smartConfig({ rootDir: import.meta.dirname }));
```

- [ ] **Step 7: Architektur-Tests laufen lassen – müssen bestehen**

Run: `pnpm --filter @smart/lint-config test`
Expected: PASS für alle Fälle.

Schlägt ein Boundaries-Fall fehl, liegt es an der Policy-Syntax von eslint-plugin-boundaries v7, nicht am Test. Dann die Doku unter `https://www.jsboundaries.dev/docs/policies/` und `…/docs/selectors/` prüfen (Schlüssel `type` vs. `types`, Negation in `fileInternalPath`/`relationship`) und **nur die Konfiguration** anpassen, bis alle Fälle grün sind. Die erwarteten Ergebnisse in den Tests bleiben unverändert.

- [ ] **Step 8: Failing Stylelint-Test**

`tools/lint-config/test/stylelint.spec.mjs`:

```js
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import stylelint from 'stylelint';
import { describe, expect, it } from 'vitest';
import config from '../stylelint/index.mjs';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const COMPONENT = 'apps/frontend/projects/ui/src/lib/button/button.scss';

async function rulesFor(code, relativePath = COMPONENT) {
  const { results } = await stylelint.lint({
    code,
    codeFilename: path.join(repoRoot, relativePath),
    config,
    cwd: repoRoot,
  });
  return results[0]?.warnings.map((w) => w.rule) ?? [];
}

describe('stylelint: only design tokens in component styles', () => {
  it('accepts token-based declarations', async () => {
    const css =
      '.a {\n  color: var(--mat-sys-primary);\n  padding: var(--smart-space-md);\n  gap: 0;\n}\n';
    expect(await rulesFor(css)).toEqual([]);
  });

  it.each([
    ['hex colors', '.a {\n  color: #fff;\n}\n', 'color-no-hex'],
    ['named colors', '.a {\n  color: red;\n}\n', 'color-named'],
    ['color functions', '.a {\n  color: rgb(0 0 0);\n}\n', 'function-disallowed-list'],
    ['raw spacing', '.a {\n  padding: 16px;\n}\n', 'scale-unlimited/declaration-strict-value'],
    ['raw gap', '.a {\n  gap: 8px;\n}\n', 'scale-unlimited/declaration-strict-value'],
    ['raw radius', '.a {\n  border-radius: 4px;\n}\n', 'scale-unlimited/declaration-strict-value'],
  ])('rejects %s', async (_name, css, rule) => {
    expect(await rulesFor(css)).toContain(rule);
  });

  it('allows raw values inside the token files', async () => {
    const scss = '$seed: #6750a4;\n:root {\n  --smart-space-md: 16px;\n}\n';
    expect(await rulesFor(scss, 'apps/frontend/projects/ui/src/lib/tokens/_palette.scss')).toEqual(
      [],
    );
  });
});
```

Run: `pnpm --filter @smart/lint-config test`
Expected: FAIL, `Cannot find module '../stylelint/index.mjs'`.

- [ ] **Step 9: Stylelint-Konfiguration implementieren**

`tools/lint-config/stylelint/index.mjs`:

```js
import { fileURLToPath } from 'node:url';
import strictValue from 'stylelint-declaration-strict-value';

const TOKEN_ONLY_PROPERTIES = [
  '/color$/',
  'fill',
  'stroke',
  'background',
  'box-shadow',
  '/^(margin|padding)/',
  'gap',
  'row-gap',
  'column-gap',
  '/^border(-.*)?-radius$/',
  'font-size',
  'font-weight',
  'font-family',
  'line-height',
  'z-index',
  '/^(transition|animation)-duration$/',
];

export default {
  extends: [fileURLToPath(import.meta.resolve('stylelint-config-standard-scss'))],
  plugins: [strictValue],
  ignoreFiles: ['**/dist/**', '**/.angular/**', 'apps/frontend/projects/ui/src/lib/tokens/**'],
  rules: {
    'color-no-hex': true,
    'color-named': 'never',
    'function-disallowed-list': [
      'rgb',
      'rgba',
      'hsl',
      'hsla',
      'hwb',
      'lab',
      'lch',
      'oklab',
      'oklch',
      'color',
    ],
    'scale-unlimited/declaration-strict-value': [
      TOKEN_ONLY_PROPERTIES,
      {
        ignoreValues: [
          'inherit',
          'initial',
          'unset',
          'currentcolor',
          'transparent',
          'none',
          'auto',
          '0',
          'normal',
        ],
        disableFix: true,
      },
    ],
  },
};
```

`stylelint.config.mjs` (Repo-Root):

```js
export { default } from '@smart/lint-config/stylelint';
```

Run: `pnpm --filter @smart/lint-config test`
Expected: PASS (alle drei Spec-Dateien).

Schlägt der Token-Datei-Fall fehl, weil `ignoreFiles` bei Übergabe als Objekt relativ zu einem anderen Verzeichnis aufgelöst wird: im Test zusätzlich `configBasedir: repoRoot` übergeben.

- [ ] **Step 10: Echtes Repo linten und Funde beheben**

Run: `pnpm lint`
Expected: keine Fehler. Funde in generiertem Code (z. B. `@typescript-eslint/no-floating-promises` in `main.ts`, Selector-Präfixe) **im Code** beheben, nicht durch Abschalten von Regeln. Bei `main.ts` ist Top-Level-`await` bereits korrekt; meldet `no-floating-promises` trotzdem etwas, die konkrete Zeile prüfen.

- [ ] **Step 11: ESLint in den Pre-Commit-Hook aufnehmen**

In `lefthook.yml` unter `pre-commit.commands` ergänzen:

```yaml
eslint:
  glob: '*.{ts,mjs}'
  run: pnpm exec eslint --no-warn-ignored {staged_files}
```

- [ ] **Step 12: Commit**

```bash
pnpm format
git add tools/lint-config eslint.config.mjs stylelint.config.mjs lefthook.yml package.json pnpm-lock.yaml apps
git commit -m "feat(lint): enforce architecture boundaries and design-token rules"
```

---

### Task 7: Lokale Infrastruktur

**Files:**

- Create: `infra/local/compose.yaml`, `infra/local/.env.example`, `infra/local/mosquitto/mosquitto.conf`, `infra/local/mosquitto/entrypoint.sh`, `infra/local/smoke-test.sh`

**Interfaces:**

- Produces: Dienste `db` (TimescaleDB, DB/User `smart`, Host-Port `127.0.0.1:5433`), `broker` (Mosquitto, nur mit Passwort, `127.0.0.1:1884`), `mail` (Mailpit, SMTP `127.0.0.1:1025`, UI/API `127.0.0.1:8025`). Zugangsdaten über Env-Variablen mit lokalen Defaults: `LOCAL_DB_PASSWORD`, `LOCAL_MQTT_USER`, `LOCAL_MQTT_PASSWORD`.

- [ ] **Step 1: Failing Smoke-Test schreiben**

`infra/local/smoke-test.sh`:

```sh
#!/usr/bin/env sh
# Verifies the local dev infrastructure is up and as locked down as intended.
set -eu

COMPOSE="docker compose -f infra/local/compose.yaml"
fail() { echo "FAIL: $1" >&2; exit 1; }

ext=$($COMPOSE exec -T db psql -U smart -d smart -tAc "select extversion from pg_extension where extname = 'timescaledb'")
[ -n "$ext" ] || fail "timescaledb extension is missing"

tz=$($COMPOSE exec -T db psql -U smart -d smart -tAc "show timezone")
[ "$tz" = "UTC" ] || fail "database time zone is '$tz', expected UTC"

if $COMPOSE exec -T broker mosquitto_pub -h localhost -t smoke/anonymous -m x >/dev/null 2>&1; then
  fail "anonymous MQTT publish was accepted"
fi

$COMPOSE exec -T broker sh -c '
  mosquitto_sub -h localhost -u "$MQTT_USER" -P "$MQTT_PASSWORD" -t smoke/auth -C 1 -W 5 > /tmp/smoke.out &
  sleep 1
  mosquitto_pub -h localhost -u "$MQTT_USER" -P "$MQTT_PASSWORD" -t smoke/auth -m ok
  wait
  grep -qx ok /tmp/smoke.out
' || fail "authenticated MQTT publish/subscribe failed"

for pair in "db 5432" "broker 1883" "mail 1025" "mail 8025"; do
  set -- $pair
  address=$($COMPOSE port "$1" "$2")
  case "$address" in
    127.0.0.1:*) ;;
    *) fail "$1:$2 is published on '$address', expected 127.0.0.1 only" ;;
  esac
done

curl -fsS "http://127.0.0.1:8025/api/v1/info" >/dev/null || fail "mailpit API is unreachable"

echo "OK: local infrastructure smoke test passed"
```

Run: `pnpm infra:test`
Expected: FAIL, `open …/infra/local/compose.yaml: no such file or directory`.

- [ ] **Step 2: Mosquitto-Konfiguration**

`infra/local/mosquitto/mosquitto.conf`:

```
listener 1883
allow_anonymous false
password_file /mosquitto/data/passwd
persistence true
persistence_location /mosquitto/data/
log_dest stdout
```

`infra/local/mosquitto/entrypoint.sh`:

```sh
#!/bin/sh
# Builds the password file from env vars on every start, so no hash is committed.
set -eu
: "${MQTT_USER:?MQTT_USER is required}"
: "${MQTT_PASSWORD:?MQTT_PASSWORD is required}"

PASSWD=/mosquitto/data/passwd
rm -f "$PASSWD"
mosquitto_passwd -c -b "$PASSWD" "$MQTT_USER" "$MQTT_PASSWORD"
chown mosquitto:mosquitto "$PASSWD"
chmod 0700 "$PASSWD"

exec mosquitto -c /mosquitto/config/mosquitto.conf
```

- [ ] **Step 3: `infra/local/compose.yaml`**

```yaml
name: smart-local

services:
  db:
    image: timescale/timescaledb:2.30.2-pg17
    command: ['postgres', '-c', 'timezone=UTC', '-c', 'log_timezone=UTC']
    environment:
      POSTGRES_USER: smart
      POSTGRES_DB: smart
      POSTGRES_PASSWORD: ${LOCAL_DB_PASSWORD:-smart-local-only}
      TZ: UTC
    ports:
      - '127.0.0.1:5433:5432'
    volumes:
      - db-data:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U smart -d smart']
      interval: 5s
      timeout: 3s
      retries: 20

  broker:
    image: eclipse-mosquitto:2.1.2-alpine
    entrypoint: ['/bin/sh', '/smart/entrypoint.sh']
    environment:
      MQTT_USER: ${LOCAL_MQTT_USER:-smart-dev}
      MQTT_PASSWORD: ${LOCAL_MQTT_PASSWORD:-smart-dev-only}
    ports:
      - '127.0.0.1:1884:1883'
    volumes:
      - ./mosquitto/mosquitto.conf:/mosquitto/config/mosquitto.conf:ro
      - ./mosquitto/entrypoint.sh:/smart/entrypoint.sh:ro
      - broker-data:/mosquitto/data
    healthcheck:
      test:
        - CMD-SHELL
        - mosquitto_sub -h localhost -u "$$MQTT_USER" -P "$$MQTT_PASSWORD" -t '$$SYS/broker/uptime' -C 1 -W 3
      interval: 5s
      timeout: 5s
      retries: 20

  mail:
    image: axllent/mailpit:v1.31.5
    ports:
      - '127.0.0.1:1025:1025'
      - '127.0.0.1:8025:8025'
    healthcheck:
      test: ['CMD', '/mailpit', 'readyz']
      interval: 5s
      timeout: 3s
      retries: 20

volumes:
  db-data:
  broker-data:
```

`infra/local/.env.example`:

```
# Local development only. Copy to infra/local/.env to override the defaults.
LOCAL_DB_PASSWORD=smart-local-only
LOCAL_MQTT_USER=smart-dev
LOCAL_MQTT_PASSWORD=smart-dev-only
```

- [ ] **Step 4: Infrastruktur starten und Smoke-Test ausführen**

Run: `pnpm infra:up && pnpm infra:test`
Expected: `up --wait` endet erst, wenn alle drei Dienste `healthy` sind; danach `OK: local infrastructure smoke test passed`.

Wird der Mailpit-Healthcheck nicht `healthy`, weil das Binary einen anderen Pfad hat: `docker compose -f infra/local/compose.yaml exec mail sh -c 'command -v mailpit'` ausführen und den Pfad im Healthcheck anpassen.

- [ ] **Step 5: Gegenprobe – der Test erkennt eine offene Konfiguration**

```bash
sed -i '' 's/allow_anonymous false/allow_anonymous true/' infra/local/mosquitto/mosquitto.conf
docker compose -f infra/local/compose.yaml up -d --wait --force-recreate broker
pnpm infra:test; echo "exit=$?"
sed -i '' 's/allow_anonymous true/allow_anonymous false/' infra/local/mosquitto/mosquitto.conf
docker compose -f infra/local/compose.yaml up -d --wait --force-recreate broker
pnpm infra:test
grep -q 'allow_anonymous false' infra/local/mosquitto/mosquitto.conf && echo "config restored"
```

Expected: erster Lauf `FAIL: anonymous MQTT publish was accepted` und `exit=1`; danach `OK: local infrastructure smoke test passed` und `config restored`.

- [ ] **Step 6: Commit**

```bash
chmod +x infra/local/smoke-test.sh infra/local/mosquitto/entrypoint.sh
pnpm format
git add infra/local
git commit -m "feat(infra): add local TimescaleDB, Mosquitto and Mailpit stack"
```

---

### Task 8: Dokumentation, ADRs und Claude-Kontext

**Files:**

- Create: `README.md`, `CLAUDE.md`, `docs/architecture/overview.md`, `docs/adr/README.md`, `docs/adr/0000-template.md`, `docs/adr/0001-…md` bis `docs/adr/0017-…md`
- Create (gitignored, nicht committen): `CLAUDE.local.md`, `.local/README.md`, `.local/server.md`, `.local/pi.md`, `.local/secrets-inventory.md`

**Interfaces:** keine Code-Schnittstellen.

- [ ] **Step 1: `README.md`**

````md
# smart-home

Selbst gehostete Smart-Home-Plattform: Angular-PWA, NestJS-Backend, TimescaleDB, Zigbee-Geräte über Zigbee2MQTT.

> Status: Fundament im Aufbau (Etappe 1). Architektur: [`docs/superpowers/specs/2026-10-11-smart-home-architecture-design.md`](docs/superpowers/specs/2026-10-11-smart-home-architecture-design.md)

## Struktur

| Pfad                 | Inhalt                                               |
| -------------------- | ---------------------------------------------------- |
| `apps/frontend`      | Angular-PWA (später inkl. Design-System `@smart/ui`) |
| `apps/backend`       | NestJS-API                                           |
| `packages/contracts` | Gemeinsame Zod-Schemas und Typen                     |
| `tools/lint-config`  | ESLint-/Stylelint-Regeln inkl. Architekturgrenzen    |
| `infra/local`        | Lokale Entwicklungsinfrastruktur                     |
| `docs/`              | Architektur, ADRs, Specs und Pläne                   |

## Voraussetzungen

Node 24.21.0 (`.nvmrc`), pnpm 12.11.2, Docker, gitleaks.

## Schnellstart

```bash
pnpm install          # baut auch @smart/contracts und installiert Git-Hooks
pnpm infra:up         # TimescaleDB, Mosquitto, Mailpit
pnpm --filter @smart/backend start:dev
pnpm --filter @smart/frontend start
```
````

## Qualitätsprüfungen

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm test:tz && pnpm build
pnpm infra:test
```

````

- [ ] **Step 2: `CLAUDE.md`**

```md
# CLAUDE.md

Smart-Home-Plattform. Verbindliche Architektur: `docs/superpowers/specs/2026-10-11-smart-home-architecture-design.md`. Entscheidungen: `docs/adr/`. Umsetzungspläne: `docs/superpowers/plans/`.

## Arbeitsweise

- Erst Spec, dann Plan, dann TDD. Keine Implementierung ohne freigegebenen Plan.
- Jede Änderung über Branch → PR → grüne CI. `main` ist geschützt.
- Privater Kontext (Hosts, Zugänge, Secret-Inventar): `CLAUDE.local.md` und `.local/` – beide gitignored.

## Konventionen

- Code, Bezeichner, Kommentare, Commit-Messages: Englisch. Doku in `docs/`: Deutsch.
- Conventional Commits mit Scope aus: repo, frontend, backend, contracts, ui, lint, infra, gateway, ci, docs, deps.
- **Keine KI-Attribution** in Commits oder PRs (kein `Co-Authored-By: Claude`, kein „Generated with …“). commitlint blockiert das.
- **Öffentliches Repo:** keine IPs, privaten Hostnamen, E-Mail-Adressen oder Secrets in versionierten Dateien. gitleaks blockiert bekannte Secret-Muster.
- TypeScript ist auf **6.0.x** gepinnt (Angular 22). Nicht auf 7 aktualisieren, bevor Angular es unterstützt.

## Befehle

| Zweck | Befehl |
|---|---|
| Alles prüfen | `pnpm lint && pnpm typecheck && pnpm test && pnpm test:tz && pnpm build` |
| Contracts nach Änderung neu bauen | `pnpm contracts:build` (oder `pnpm --filter @smart/contracts dev`) |
| Lokale Infrastruktur | `pnpm infra:up`, `pnpm infra:test`, `pnpm infra:down` |
| Backend / Frontend | `pnpm --filter @smart/backend start:dev`, `pnpm --filter @smart/frontend start` |

Lokale Ports (nur 127.0.0.1): DB 5433, MQTT 1884, Mailpit SMTP 1025 / UI 8025.

## Architekturregeln (per Lint erzwungen)

- Backend: `platform/` → nichts Fachliches; `core/*` → nie `modules/*`; Module nie untereinander; fremde Elemente nur über deren `index.ts`.
- Frontend: Features nie untereinander; `core/` und `shell/` nie auf Features; fremde Elemente nur über `index.ts`.
- Frontend-UI: kein `@angular/material`/`@angular/cdk` außerhalb von `@smart/ui`; keine Komponenten-Styles außerhalb von `@smart/ui`; in `@smart/ui` nur Design-Tokens (keine Hex-Farben, keine px-Abstände außerhalb `tokens/`); keine `DatePipe`.
- Zeit: speichern/übertragen nur UTC (`…Z`), Anzeige in Haushalts-Zeitzone, reine Datumswerte als `YYYY-MM-DD`-String. Tests laufen zusätzlich mit `TZ=Pacific/Chatham`.

Regeln nie abschalten, um einen Fund loszuwerden. Passt eine Regel nicht, wird die Regel (mit Test) in `tools/lint-config` angepasst.
````

- [ ] **Step 3: `docs/architecture/overview.md`**

```md
# Architekturüberblick

Kurzfassung der verbindlichen Spec ([`../superpowers/specs/2026-10-11-smart-home-architecture-design.md`](../superpowers/specs/2026-10-11-smart-home-architecture-design.md)).
```

HEIMNETZ VPS
┌─────────────── Pi ───────────────────┐ ┌──────────────────────────────────────────────┐
│ Zigbee-Geräte ⇄ Koordinator (USB) │ │ Reverse Proxy :443 │
│ zigbee2mqtt ⇄ mosquitto (lokal) ───┼─mTLS─┼─▶ Broker :8883 │
│ Bridge + Puffer │ │ Stacks smart-prod / smart-staging: │
└──────────────────────────────────────┘ │ web · api · db · broker (+ simulator) │
└──────────────────────────────────────────────┘

```

- **Gateway** (Pi): Zigbee2MQTT + Mosquitto, Bridge per mTLS zum VPS, puffert Messwerte bei Ausfall.
- **api** (NestJS): `platform/` (Technik), `core/` (gerätetyp-unabhängiger Kern), `modules/` (Features).
- **web** (Angular-PWA): `core/`, `shell/`, `features/`, Design-System `@smart/ui`.
- **db**: TimescaleDB; Messwerte hängen am logischen Gerät, nicht an der Hardware.

Entscheidungen im Detail: [`../adr/README.md`](../adr/README.md).
```

- [ ] **Step 4: ADR-Vorlage und Index**

`docs/adr/0000-template.md`:

```md
# ADR-NNNN: Titel

- Status: angenommen
- Datum: JJJJ-MM-TT

## Kontext

## Entscheidung

## Konsequenzen
```

`docs/adr/README.md`:

```md
# Architecture Decision Records

Neue Entscheidung: `0000-template.md` kopieren, nächste Nummer vergeben, hier eintragen. Ersetzte ADRs bekommen den Status „ersetzt durch ADR-NNNN“.

| ADR                                             | Titel                                                  |
| ----------------------------------------------- | ------------------------------------------------------ |
| [0001](0001-monorepo-pnpm-workspaces.md)        | Monorepo mit pnpm-Workspaces                           |
| [0002](0002-gateway-mqtt-bridge-mtls.md)        | Pi ↔ VPS über Mosquitto-Bridge mit mTLS und eigener CA |
| [0003](0003-central-logic-on-vps.md)            | Zentrale Logik auf dem VPS, Pi als Gateway mit Puffer  |
| [0004](0004-buffer-telemetry-never-commands.md) | Messwerte puffern, Befehle nie                         |
| [0005](0005-timescaledb-per-environment.md)     | TimescaleDB in eigenen Containern pro Umgebung         |
| [0006](0006-logical-device-vs-hardware.md)      | Logisches Gerät getrennt von Hardware                  |
| [0007](0007-passwordless-login.md)              | Passwortloser Login: Passkeys + E-Mail-Code            |
| [0008](0008-server-sessions.md)                 | Server-Sessions mit `__Host-`-Cookie                   |
| [0009](0009-users-households-roles.md)          | Benutzer, Haushalte, Rollen, Einladungen               |
| [0010](0010-sse-for-live-updates.md)            | SSE für Live-Updates                                   |
| [0011](0011-ui-library-wraps-material.md)       | Angular Material gekapselt in `@smart/ui`              |
| [0012](0012-runtime-theming.md)                 | Laufzeit-Theming mit material-color-utilities          |
| [0013](0013-i18n-transloco.md)                  | i18n mit Transloco (DE/EN)                             |
| [0014](0014-utc-everywhere.md)                  | UTC überall, Anzeige in Haushalts-Zeitzone             |
| [0015](0015-staging-and-image-promotion.md)     | Staging + Produktion mit Image-Promotion               |
| [0016](0016-forced-command-deploy.md)           | Deploy per Forced-Command-SSH-Key                      |
| [0017](0017-backups-restic-b2.md)               | Backups mit restic nach Backblaze B2 (EU)              |
```

- [ ] **Step 5: ADR 0001–0017 anlegen**

Für jede Zeile der folgenden Tabelle eine Datei mit dem Dateinamen aus dem Index anlegen, nach der Vorlage, `Status: angenommen`, `Datum: 2026-10-11`, Titel aus dem Index. Die drei Abschnitte erhalten genau den Text aus der Tabelle; am Ende jedes ADR die Zeile `Details: Spec, Abschnitt X.` mit dem angegebenen Abschnitt.

| ADR  | Kontext                                                                                                                      | Entscheidung                                                                                                                      | Konsequenzen                                                                                                                                                            | Spec       |
| ---- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 0001 | Frontend und Backend teilen API-Verträge; ein Repo für alles ist gewünscht.                                                  | pnpm-Workspaces ohne Nx; Original-CLIs von Angular und Nest; gemeinsame Pakete unter `packages/`; Grenzen per ESLint.             | Kein Build-Cache/keine Generatoren von Nx; Angular-Updates direkt über `ng update`; Modulgrenzen müssen selbst gepflegt werden (`tools/lint-config`).                   | 5.1        |
| 0002 | Der Pi steht hinter NAT; der VPS braucht Gerätedaten und muss Befehle senden; eingehende Ports im Heimnetz sind unerwünscht. | Mosquitto-Bridge vom Pi zum VPS-Broker über TLS mit Client-Zertifikaten einer eigenen CA; ACL per Zertifikats-CN.                 | Port 8883 ist öffentlich, aber ohne gültiges Zertifikat scheitert der Handshake; CA-Schlüssel muss offline gesichert werden; neue Gateways brauchen nur ein Zertifikat. | 4          |
| 0003 | Automationen könnten lokal (Pi) oder zentral (VPS) laufen.                                                                   | Gesamte Logik auf dem VPS; der Pi ist nur Gateway mit Messwert-Puffer; kritische Abläufe über direkte Zigbee-Bindings.            | Bei Internetausfall keine App-Steuerung und keine Automationen; kein zweiter Logik-Ort; späterer Hybrid-Betrieb bleibt möglich.                                         | 1.3, 4.1   |
| 0004 | Nach einem Ausfall nachgelieferte Daten sind wertvoll, nachgelieferte Befehle gefährlich.                                    | Messwerte werden auf dem Pi gepuffert; Befehle werden mit QoS 0 gesendet und bei offline Gateway sofort abgelehnt.                | `GATEWAY_OFFLINE` als Fehlerfall in der App; Broker auf dem VPS stellt keine QoS-0-Nachrichten für offline Clients zu.                                                  | 8.6        |
| 0005 | Zeitreihen brauchen Kompression, Retention und Aggregate; auf dem VPS läuft bereits ein gemeinsamer Postgres.                | Eigene TimescaleDB-Container pro Umgebung statt des bestehenden Postgres.                                                         | Etwas mehr RAM; dafür Isolation, eigene Extension, unabhängige Upgrades und Backups.                                                                                    | 3.2        |
| 0006 | Sensoren werden getauscht oder neu gekoppelt; der Verlauf soll erhalten bleiben.                                             | Messwerte hängen am logischen Gerät; Hardware wird über Bindungen mit Historie zugeordnet.                                        | Neue Hardware ist zunächst „nicht zugeordnet“; Zuordnung ist ein expliziter Schritt in der App.                                                                         | 8.4        |
| 0007 | Passwörter sind ein Risiko; Recovery-Codes sind unbequem.                                                                    | Passkeys als Hauptweg, E-Mail-Code (Resend) als Alternative, CLI-Recovery-Link als Notfall; keine Passwörter.                     | Das E-Mail-Konto wird zum Generalschlüssel und braucht 2FA; Mailversand ist Pflichtinfrastruktur.                                                                       | 7.2        |
| 0008 | Login-Zustand muss widerrufbar und vor JavaScript-Zugriff geschützt sein.                                                    | Opake Session-Token, gehasht in Postgres, im `__Host-session`-Cookie (`HttpOnly`, `Secure`, `SameSite=Lax`).                      | Jede Session einzeln widerrufbar; CSRF-Schutz über `SameSite` + `Origin`-Prüfung nötig.                                                                                 | 7.3        |
| 0009 | Erst ein Nutzer, später ein Haushalt mit mehreren Personen.                                                                  | User ↔ Household über Memberships mit Rollen `owner`/`member`/`viewer`; Registrierung nur per Einladung; Plattform-Admin separat. | Mandantentrennung muss in jedem Endpunkt geprüft und getestet werden.                                                                                                   | 7.1, 7.4   |
| 0010 | Die App braucht Live-Daten; Befehle laufen über REST.                                                                        | Server-Sent Events pro Haushalt statt WebSocket.                                                                                  | Einfache Proxy-Konfiguration, Cookie-Auth, Auto-Reconnect; nur Server → Client.                                                                                         | 8.7        |
| 0011 | Die UI soll ausschließlich aus Shared Components bestehen und M3 folgen.                                                     | Angular Material ist internes Detail von `@smart/ui`; Features ohne eigenes CSS; nur Design-Tokens; alles per Lint erzwungen.     | Fehlende UI erfordert eine neue `ui-*`-Komponente; einheitliches Erscheinungsbild ist technisch gesichert.                                                              | 10.2, 10.3 |
| 0012 | Themes sollen wie im Material Theme Builder funktionieren.                                                                   | Laufzeit-Theming mit `@material/material-color-utilities`: Grundfarbe, Variante, Modus, Kontrast; harmonisierte Statusfarben.     | Komponenten dürfen nur Farbrollen nutzen; Standard-Theme wird zusätzlich beim Build erzeugt (kein Aufblitzen).                                                          | 10.5       |
| 0013 | Deutsch und Englisch von Anfang an, umschaltbar zur Laufzeit.                                                                | Transloco mit Übersetzungsdateien pro Feature; API liefert Fehlercodes statt Texten.                                              | Kein Angular-eigenes i18n; CI prüft fehlende Schlüssel.                                                                                                                 | 10.9       |
| 0014 | Sommer-/Winterzeit und verschiedene Zeitzonen führen leicht zu Fehlern.                                                      | UTC in DB und API (`…Z`), Anzeige in der Haushalts-Zeitzone, Tageswerte zeitzonenbewusst, reine Daten als String.                 | Zod lehnt Zeitstempel ohne `Z` ab; Tests laufen zusätzlich mit exotischer Zeitzone.                                                                                     | 9          |
| 0015 | Änderungen sollen vor Produktion in einer realistischen Umgebung laufen.                                                     | Staging + Produktion; Images einmal bauen, nach Freigabe unverändert befördern.                                                   | Zweiter Stack auf dem VPS; Staging nutzt nur den Simulator und kann keine echten Geräte schalten.                                                                       | 6.2        |
| 0016 | GitHub Actions braucht Zugriff auf den VPS, das Repo ist öffentlich.                                                         | SSH-Key pro Environment, beschränkt auf einen Forced Command `smart-deploy <env> <sha>`.                                          | Ein gestohlener Deploy-Key kann nur Deploys bekannter Commits auslösen.                                                                                                 | 6.2        |
| 0017 | Datenbank und Gateway-Daten brauchen eine Kopie außerhalb des VPS.                                                           | restic, verschlüsselt, nach Backblaze B2 (EU), mit monatlichem automatisiertem Restore-Test.                                      | Monatliche Kosten nahe null; Backup-Ausfälle melden sich über healthchecks.io.                                                                                          | 11.3       |

- [ ] **Step 6: Private Doku anlegen (nicht committen)**

`CLAUDE.local.md`:

```md
# Privater Kontext (gitignored)

@.local/README.md
```

`.local/README.md`: Index mit Links auf `server.md`, `pi.md`, `secrets-inventory.md` und dem Hinweis „Nie committen. Werte für Platzhalter wie `<VPS_HOST>` stehen hier.“

`.local/server.md`: aus der privaten Server-Doku übernehmen: VPS-Host und IPs, SSH-User und Key-Pfad, Docker-Verzeichnisse, Reverse-Proxy-Details, laufende Container, bereits vorhandene Datenbank-Container („nicht mitbenutzen“), DNS-Einträge inkl. `*.smart`. **Keine Passwörter.**

`.local/pi.md`: Pi 3B+ (Debian 13, Docker), LAN-Adresse, SSH-User `claude` und `till`, Compose-Verzeichnis `/home/till/smart-home`, Koordinator CC2531, gekoppelte Geräte, Befunde aus der Analyse (anonymes MQTT, Z2M-Frontend ohne Auth, kein eigener `network_key`).

`.local/secrets-inventory.md`:

```md
# Secret-Inventar (nur Ort und Zweck, nie Werte)

| Secret                        | Zweck                           | Ort                               | Status   |
| ----------------------------- | ------------------------------- | --------------------------------- | -------- |
| CA-Schlüssel (PKI)            | Zertifikate für Broker/Gateways | `~/.smart-pki/` + Passwortmanager | Etappe 5 |
| Deploy-Key staging            | GitHub Actions → VPS            | GitHub Environment `staging`      | Etappe 2 |
| Deploy-Key production         | GitHub Actions → VPS            | GitHub Environment `production`   | Etappe 2 |
| DB-Passwort staging/prod      | Postgres                        | `.env` auf VPS + Passwortmanager  | Etappe 2 |
| Session-Secret                | Backend                         | `.env` auf VPS                    | Etappe 4 |
| Resend API-Key                | Mailversand                     | `.env` auf VPS + Passwortmanager  | Etappe 4 |
| VAPID-Keys                    | Web-Push                        | `.env` auf VPS + Passwortmanager  | Etappe 7 |
| Backblaze B2 Application Keys | restic-Backups (VPS, Pi)        | Host-`.env` + Passwortmanager     | Etappe 2 |
| restic-Repository-Passwort    | Backup-Verschlüsselung          | Passwortmanager + Host            | Etappe 2 |
| UptimeRobot / healthchecks.io | Monitoring-Accounts             | Passwortmanager                   | Etappe 0 |
```

- [ ] **Step 7: Prüfen, dass nichts Privates committet wird**

Run:

```bash
git status --short --ignored | grep -E "\.local|CLAUDE.local"
grep -rnE "([0-9]{1,3}\.){3}[0-9]{1,3}" README.md CLAUDE.md docs/ || echo "no private data in public docs"
```

Expected: `.local/` und `CLAUDE.local.md` erscheinen nur als ignoriert (`!!`); zweiter Befehl gibt `no private data in public docs` aus. Trifft der IP-Regex auf Versionsnummern (z. B. `2.30.2`), die Treffer einzeln prüfen: echte IPs entfernen, Versionsnummern sind in Ordnung.

- [ ] **Step 8: Commit**

```bash
pnpm format
git add README.md CLAUDE.md docs
git commit -m "docs: add architecture overview, ADRs and CLAUDE.md"
```

---

### Task 9: CI, CodeQL, Dependabot

**Files:**

- Create: `.github/workflows/ci.yml`, `.github/workflows/codeql.yml`, `.github/dependabot.yml`, `.github/pull_request_template.md`

**Interfaces:**

- Produces: Status-Checks mit den exakten Namen `secrets`, `verify`, `infra-local` (Task 10 macht sie zur Pflicht) sowie `codeql (javascript-typescript)` und `codeql (actions)`.

- [ ] **Step 1: `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  secrets:
    name: secrets
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          fetch-depth: 0
          persist-credentials: false
      - name: gitleaks
        run: >
          docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -v "$PWD:/repo"
          ghcr.io/gitleaks/gitleaks:v8.30.1 git /repo --config /repo/.gitleaks.toml --redact --verbose --no-banner

  verify:
    name: verify
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
      - run: pnpm format:check
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm test:tz
      - run: pnpm build

  infra-local:
    name: infra-local
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - run: docker compose -f infra/local/compose.yaml up -d --wait
      - run: sh infra/local/smoke-test.sh
      - if: always()
        run: docker compose -f infra/local/compose.yaml down -v
```

- [ ] **Step 2: `.github/workflows/codeql.yml`**

```yaml
name: CodeQL

on:
  push:
    branches: [main]
  pull_request:
  schedule:
    - cron: '23 4 * * 1'

permissions:
  contents: read

jobs:
  analyze:
    name: codeql
    runs-on: ubuntu-24.04
    permissions:
      contents: read
      security-events: write
      actions: read
    strategy:
      fail-fast: false
      matrix:
        language: [javascript-typescript, actions]
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: github/codeql-action/init@24c54180a607b1449ed407dd24f251e4e9147c8d # v4.38.3
        with:
          languages: ${{ matrix.language }}
          build-mode: none
      - uses: github/codeql-action/analyze@24c54180a607b1449ed407dd24f251e4e9147c8d # v4.38.3
        with:
          category: /language:${{ matrix.language }}
```

- [ ] **Step 3: `.github/dependabot.yml`**

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
      day: monday
    commit-message:
      prefix: chore
      include: scope
    ignore:
      - dependency-name: typescript
        update-types: ['version-update:semver-major', 'version-update:semver-minor']
    groups:
      angular:
        patterns: ['@angular/*', '@angular-devkit/*', '@schematics/*', 'angular-eslint']
      nestjs:
        patterns: ['@nestjs/*']
      lint:
        patterns:
          [
            'eslint',
            'eslint-*',
            '@eslint/*',
            'typescript-eslint',
            'stylelint',
            'stylelint-*',
            'prettier',
            '@commitlint/*',
            'lefthook',
          ]
      test:
        patterns: ['vitest', '@vitest/*', 'supertest', '@types/supertest', 'jsdom']

  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
      day: monday
    commit-message:
      prefix: chore
      include: scope

  - package-ecosystem: docker-compose
    directory: /infra/local
    schedule:
      interval: weekly
      day: monday
    commit-message:
      prefix: chore
      include: scope
```

- [ ] **Step 4: `.github/pull_request_template.md`**

```md
## Was und warum

## Plan / Spec

<!-- z. B. docs/superpowers/plans/…md, Task N -->

## Prüfungen

- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm test:tz && pnpm build`
- [ ] keine privaten Daten (IPs, Hosts, E-Mails, Secrets) im Diff
```

- [ ] **Step 5: Workflows lokal validieren**

Run:

```bash
docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:latest -color
```

Expected: keine Ausgabe (keine Fehler). Meldet actionlint Fehler, diese beheben.

- [ ] **Step 6: CI-Ablauf lokal simulieren (frischer Stand)**

```bash
git status --short   # muss leer sein; sonst erst committen
rm -rf node_modules apps/*/node_modules packages/*/node_modules tools/*/node_modules packages/contracts/dist
LEFTHOOK=0 pnpm install --frozen-lockfile && pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm test:tz && pnpm build
pnpm exec lefthook install
```

Expected: alle Schritte grün. `.local/` und `CLAUDE.local.md` sind ignoriert und bleiben unberührt.

- [ ] **Step 7: Commit**

```bash
git add .github
git commit -m "ci: add CI, CodeQL and Dependabot configuration"
```

---

### Task 10: GitHub-Repo, Schutzregeln und erster PR

Diese Task veröffentlicht Code. Vor Step 2 bei Till nachfragen und erst nach seinem Ja fortfahren.

**Files:**

- Create: `infra/github/ruleset-main.json`

**Interfaces:**

- Consumes: Status-Check-Namen `secrets`, `verify`, `infra-local` aus Task 9.

- [ ] **Step 1: Ruleset-Datei anlegen und committen**

`infra/github/ruleset-main.json`:

```json
{
  "name": "main",
  "target": "branch",
  "enforcement": "active",
  "conditions": {
    "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] }
  },
  "bypass_actors": [],
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "required_linear_history" },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false,
        "allowed_merge_methods": ["squash"]
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": true,
        "required_status_checks": [
          { "context": "secrets" },
          { "context": "verify" },
          { "context": "infra-local" }
        ]
      }
    }
  ]
}
```

```bash
pnpm format
git add infra/github
git commit -m "chore(repo): add main branch ruleset definition"
```

- [ ] **Step 2: Freigabe von Till einholen**

Frage: „Ich lege jetzt `tkosiol/smart-home` öffentlich an, pushe `main` (Spec + Plan) und den Branch `feat/repo-foundation` und öffne den ersten PR. Einverstanden?“ Erst bei „ja“ weiter.

- [ ] **Step 3: Repo anlegen und `main` pushen**

```bash
gh repo create tkosiol/smart-home --public --description "Self-hosted smart home platform (Angular, NestJS, Zigbee2MQTT)" --disable-wiki
git remote add origin "$(gh repo view tkosiol/smart-home --json sshUrl -q .sshUrl)"
git push -u origin main
```

Expected: Repo existiert; `main` enthält Spec und Plan.

- [ ] **Step 4: Repo-Einstellungen**

```bash
gh api -X PATCH repos/tkosiol/smart-home \
  -F allow_squash_merge=true -F allow_merge_commit=false -F allow_rebase_merge=false \
  -F delete_branch_on_merge=true -F has_projects=false \
  -f squash_merge_commit_title=PR_TITLE -f squash_merge_commit_message=PR_BODY
gh api -X PATCH repos/tkosiol/smart-home --input - <<'JSON'
{"security_and_analysis":{"secret_scanning":{"status":"enabled"},"secret_scanning_push_protection":{"status":"enabled"}}}
JSON
gh api -X PUT repos/tkosiol/smart-home/vulnerability-alerts
gh api -X POST repos/tkosiol/smart-home/rulesets --input infra/github/ruleset-main.json
```

- [ ] **Step 5: Einstellungen verifizieren**

```bash
gh api repos/tkosiol/smart-home --jq '{squash: .allow_squash_merge, merge: .allow_merge_commit, rebase: .allow_rebase_merge, push_protection: .security_and_analysis.secret_scanning_push_protection.status}'
gh api repos/tkosiol/smart-home/rulesets --jq '.[] | {name, enforcement}'
```

Expected: `squash: true, merge: false, rebase: false, push_protection: "enabled"`; Ruleset `main` mit `active`. Der praktische Schutztest folgt in Step 8.

- [ ] **Step 6: Branch pushen und PR öffnen**

```bash
git push -u origin feat/repo-foundation
gh pr create --base main --head feat/repo-foundation \
  --title "chore(repo): repository foundation (Etappe 1)" \
  --body "Implements docs/superpowers/plans/2026-10-11-etappe-0-1-repo-fundament.md (Tasks 1–10): pnpm workspace, commit hygiene, @smart/contracts, NestJS and Angular skeletons, architecture lint rules, local infrastructure, docs/ADRs, CI."
```

Die PR-Beschreibung enthält keine KI-Attribution.

- [ ] **Step 7: CI beobachten**

Run: `gh pr checks --watch`
Expected: `secrets`, `verify`, `infra-local`, `codeql (javascript-typescript)`, `codeql (actions)` sind grün. Schlägt ein Check fehl: Logs mit `gh run view --log-failed` lesen, Ursache auf dem Branch beheben, pushen, erneut beobachten.

- [ ] **Step 8: Schutz von `main` praktisch prüfen**

```bash
git switch main
git commit --allow-empty -m "chore(repo): protection test"
git push origin main; echo "exit=$?"
git reset -q --hard origin/main
git switch feat/repo-foundation
```

Expected: Push wird abgelehnt (`push declined due to repository rule violations`), `exit=1`; der lokale Test-Commit wird verworfen.

- [ ] **Step 9: Merge durch Till**

Till prüft den PR auf GitHub und merged per „Squash and merge“ (oder bittet Claude um `gh pr merge --squash --delete-branch`). Danach:

```bash
git switch main && git pull --ff-only
gh run list --branch main --limit 3
```

Expected: CI auf `main` grün.
