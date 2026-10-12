import type { StorybookConfig } from '@storybook/angular';

const config: StorybookConfig = {
  stories: ['../projects/ui/src/**/*.mdx', '../projects/ui/src/**/*.stories.ts'],
  addons: ['@storybook/addon-a11y', '@storybook/addon-docs'],
  framework: { name: '@storybook/angular', options: {} },
  staticDirs: ['../public'],
  core: { disableTelemetry: true },
};
export default config;
