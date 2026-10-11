#!/usr/bin/env node
// Writes the build-time default theme for the web app from the instance default appearance.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_INSTANCE_APPEARANCE } from '@smart/contracts';
import { renderDefaultThemeCss } from '../dist/index.js';

const target = fileURLToPath(
  new URL('../../../apps/frontend/projects/ui/src/lib/tokens/default-theme.css', import.meta.url),
);
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, renderDefaultThemeCss(DEFAULT_INSTANCE_APPEARANCE));
console.log(`wrote ${target}`);
