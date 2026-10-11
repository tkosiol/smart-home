import { defineConfig } from 'eslint/config';
import { smartConfig } from '@smart/lint-config/eslint';

export default defineConfig(smartConfig({ rootDir: import.meta.dirname }));
