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

  it('knows Node globals in JavaScript tooling files', async () => {
    const [result] = await rootLinter.lintText(
      "export const here = new URL('.', import.meta.url);\n",
      {
        filePath: path.join(repoRoot, 'tools/lint-config/canary.mjs'),
      },
    );
    expect(result.messages.map((m) => m.ruleId)).toEqual([]);
  });

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
