import type { Page } from 'playwright';
import type { TestRunnerConfig } from '@storybook/test-runner';
import { checkA11y, injectAxe } from 'axe-playwright';

const AXE_OPTIONS = {
  detailedReport: true,
  detailedReportOptions: { html: true },
  axeOptions: {
    // WCAG 2.x A/AA including 2.2 (spec 10); `target-size` is disabled by default in axe-core.
    runOnly: {
      type: 'tag' as const,
      values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'],
    },
    rules: { 'target-size': { enabled: true } },
  },
};

/** A second, demanding theme: every story is also checked dark, high contrast, amber seed. */
const SECOND_THEME = 'mode:dark;contrast:high;seed:!hex(8a5a00)';

async function checkStory(page: Page): Promise<void> {
  await injectAxe(page);
  await checkA11y(page, '#storybook-root', AXE_OPTIONS);
}

const config: TestRunnerConfig = {
  async postVisit(page) {
    await checkStory(page);
    // The second theme is checked on a fresh page: navigating the runner's own page would drop
    // the helpers it injected for the following stories.
    const url = new URL(page.url());
    // The runner visits iframe.html with a literal `{{viewMode}}` placeholder;
    // a fresh load needs the real value.
    url.searchParams.set('viewMode', 'story');
    url.searchParams.set('globals', SECOND_THEME);
    const themed = await page.context().newPage();
    try {
      await themed.goto(url.toString());
      // Fails the story if the second theme was not applied – the check would otherwise be vacuous.
      await themed.waitForFunction(
        () =>
          document.documentElement.style.colorScheme === 'dark' &&
          document.querySelector('#storybook-root')?.childElementCount !== 0,
        undefined,
        { timeout: 10_000 },
      );
      await checkStory(themed);
    } finally {
      await themed.close();
    }
  },
};
export default config;
