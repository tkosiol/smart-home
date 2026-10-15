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

/**
 * A second pass: every story is also checked dark and in English, with the default seed and
 * contrast. Seeds, variants and contrast levels come from the generator (Till, 2026-10-15).
 */
const SECOND_THEME = 'mode:dark;locale:en';

/** Storybook preview events that end a story: success, or one of the error paths. */
const DONE_EVENT = 'storyRendered';
const FAILURE_EVENTS = ['playFunctionThrewException', 'storyThrewException', 'storyErrored'];

// Must stay below Jest's per-test timeout (15 s) together, so a stall reports a clear message.
const NAVIGATION_TIMEOUT = 5_000;
const COMPLETION_TIMEOUT = 8_000;

/**
 * Registers (before any page script runs) a listener on Storybook's preview channel that records
 * whether the story finished rendering and playing, or failed. The channel is hooked the moment
 * the preview assigns it, so no event can be missed.
 */
function trackStoryOutcome({ done, failures }: { done: string; failures: string[] }): void {
  const outcome = { state: 'pending', detail: '' };
  (window as unknown as Record<string, unknown>)['__smartStoryOutcome'] = outcome;
  let channel: unknown;
  Object.defineProperty(window, '__STORYBOOK_ADDONS_CHANNEL__', {
    configurable: true,
    get: () => channel,
    set: (value: { on(event: string, listener: (payload: unknown) => void): void }) => {
      channel = value;
      value.on(done, () => {
        if (outcome.state === 'pending') outcome.state = 'rendered';
      });
      for (const event of failures) {
        value.on(event, (payload) => {
          outcome.state = 'failed';
          outcome.detail = `${event}: ${JSON.stringify(payload)}`;
        });
      }
    },
  });
}

/**
 * Disabled controls are exempt from the contrast minimum (WCAG 1.4.3), but axe only recognises
 * them through ARIA attributes the list row must not carry on a plain div. So the dimmed row of
 * `ui-list-item` is scanned separately with `color-contrast` off; every other rule still applies
 * to it, and every rule (contrast included) applies to the rest of the page.
 */
const INACTIVE = '.row--disabled';

async function checkStory(page: Page): Promise<void> {
  await injectAxe(page);
  await checkA11y(page, { include: ['#storybook-root'], exclude: [[INACTIVE]] }, AXE_OPTIONS);
  // axe throws on an empty include, so scan inactive rows only when the story has some.
  if (await page.$(`#storybook-root ${INACTIVE}`)) {
    await checkA11y(
      page,
      { include: [[`#storybook-root ${INACTIVE}`]] },
      {
        ...AXE_OPTIONS,
        axeOptions: {
          ...AXE_OPTIONS.axeOptions,
          rules: { ...AXE_OPTIONS.axeOptions.rules, 'color-contrast': { enabled: false } },
        },
      },
    );
  }
}

const config: TestRunnerConfig = {
  // Play, render and exception errors of the runner's own (default theme) visit.
  errorMessageFormatter: (message) => `Story failed in the default theme:\n${message}`,
  async postVisit(page, context) {
    // The runner calls postVisit with `hasFailure` when the story failed in the default theme and
    // then rethrows that error itself – anything thrown here would hide it.
    if (context.hasFailure) return;
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
      await themed.addInitScript(trackStoryOutcome, {
        done: DONE_EVENT,
        failures: FAILURE_EVENTS,
      });
      await themed.goto(url.toString(), { timeout: NAVIGATION_TIMEOUT });
      // Render and play must be finished (axe would otherwise see a half-built DOM) and must
      // not have failed; the theme must really be the second one, or the check is vacuous.
      await themed.waitForFunction(
        () => {
          const outcome = (window as unknown as Record<string, { state: string }>)[
            '__smartStoryOutcome'
          ];
          return outcome?.state !== 'pending';
        },
        undefined,
        { timeout: COMPLETION_TIMEOUT },
      );
      const { state, detail } = await themed.evaluate(
        () =>
          (window as unknown as Record<string, { state: string; detail: string }>)[
            '__smartStoryOutcome'
          ]!,
      );
      if (state !== 'rendered' || (await themed.locator('body.sb-show-errordisplay').count()) > 0) {
        throw new Error(`Story failed under the second theme (${SECOND_THEME}): ${detail}`);
      }
      const scheme = await themed.evaluate(() => document.documentElement.style.colorScheme);
      if (scheme !== 'dark') {
        throw new Error(`Second theme not applied: color-scheme is "${scheme}", expected "dark"`);
      }
      await checkStory(themed);
    } finally {
      await themed.close();
    }
  },
};
export default config;
