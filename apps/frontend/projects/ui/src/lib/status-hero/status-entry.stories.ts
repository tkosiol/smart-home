import { provideRouter, withDisabledInitialNavigation } from '@angular/router';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';
import { expect } from 'storybook/test';
import { expectNoHorizontalOverflow, withPhoneFrame } from '../testing/story-helpers';
import { waitForTranslations } from '../testing/storybook-environment';
import { rgb } from '../testing/theme-matrix';
import { UiStatusEntry } from './status-entry';

const meta: Meta<UiStatusEntry> = {
  title: 'Inhalt/Status-Eintrag',
  component: UiStatusEntry,
  decorators: [
    // Storybook's iframe path matches no route; without this the router's initial navigation fails
    // and rewrites the URL, which breaks the second-theme check of the test runner.
    applicationConfig({ providers: [provideRouter([], withDisabledInitialNavigation())] }),
  ],
};
export default meta;

const root = () => getComputedStyle(document.documentElement);

/** The colour of a token, as the browser computes `background-color` for it. */
const token = (name: string) => rgb(root().getPropertyValue(name).trim());

/**
 * A link's hover must still show on `row` and `bare` entries. A real pointer cannot be forced here
 * (`:hover` ignores synthetic events), so the check reads the component's style rules: the hover
 * rule of the link has to set the hover surface and carry the host's `data-variant` in its
 * selector, which is what makes it outrank the variants' own `background` on `.entry`.
 */
async function expectHoverRule() {
  const hoverRules = [...document.styleSheets]
    .flatMap((sheet) => [...sheet.cssRules])
    .filter(
      (rule): rule is CSSStyleRule =>
        rule instanceof CSSStyleRule &&
        rule.selectorText.includes('.link') &&
        rule.selectorText.includes(':hover'),
    );
  const outranking = hoverRules.filter((rule) => rule.selectorText.includes('data-variant'));
  await expect(outranking).toHaveLength(1);
  await expect(outranking[0]!.style.getPropertyValue('background')).toContain(
    '--mat-sys-surface-container-high',
  );
}

/** Stands alone on the page like the hero's calm row: 56 px, a pill on surface-container-low. */
export const Row: StoryObj<UiStatusEntry> = {
  render: () => ({
    template: `<div style="max-width: 420px; display: grid; gap: 8px">
      <ui-status-entry variant="row" icon="router" kindTone="ok-container" title="Flur" subtitle="Gateway online · Letzte Nachricht vor 3 Minuten" route="/mehr/gateways" />
      <ui-status-entry variant="row" icon="router" kindTone="error" title="Keller" subtitle="Gateway offline · Noch keine Nachricht empfangen" />
    </div>`,
  }),
  play: async ({ canvas, canvasElement }) => {
    await waitForTranslations();
    for (const host of canvasElement.querySelectorAll('ui-status-entry')) {
      await expect(host).toHaveAttribute('data-variant', 'row');
    }
    const [linked, plain] = [...canvasElement.querySelectorAll<HTMLElement>('.entry')] as [
      HTMLElement,
      HTMLElement,
    ];
    await expect(getComputedStyle(plain).backgroundColor).toBe(
      token('--mat-sys-surface-container-low'),
    );
    await expect(linked.getBoundingClientRect().height).toBe(56);
    await expect(canvas.getByRole('link', { name: /Flur/ }).getAttribute('href')).toMatch(
      /\/mehr\/gateways$/,
    );
    // The linked row has the surface too, and still reacts to the pointer.
    await expect(getComputedStyle(linked).backgroundColor).toBe(
      token('--mat-sys-surface-container-low'),
    );
    await expectHoverRule();
  },
};

/** No surface of its own (a row inside a pod); the description wraps instead of being cut. */
export const Bare: StoryObj<UiStatusEntry> = {
  render: () => ({
    template: `<div style="max-width: 420px; display: grid; gap: 8px">
      <ui-status-entry variant="bare" icon="tune" kindTone="primary-container" title="Status" subtitle="Was gerade Aufmerksamkeit braucht, auf einen Blick, auch wenn die Beschreibung länger ist als eine Zeile" route="/mehr" />
      <ui-status-entry variant="bare" icon="tune" kindTone="surface" title="Geräte" subtitle="Deine Pflanzen und Sensoren" />
    </div>`,
  }),
  play: async ({ canvas, canvasElement }) => {
    await waitForTranslations();
    for (const host of canvasElement.querySelectorAll('ui-status-entry')) {
      await expect(host).toHaveAttribute('data-variant', 'bare');
    }
    const [linked, plain] = [...canvasElement.querySelectorAll<HTMLElement>('.entry')] as [
      HTMLElement,
      HTMLElement,
    ];
    await expect(getComputedStyle(plain).backgroundColor).toBe('rgba(0, 0, 0, 0)');
    await expect(getComputedStyle(linked).backgroundColor).toBe('rgba(0, 0, 0, 0)');
    // The description wraps: the subtitle is taller than one line and nothing is cut.
    const subtitle = linked.querySelector<HTMLElement>('.subtitle')!;
    await expect(getComputedStyle(subtitle).whiteSpace).toBe('normal');
    await expect(subtitle.scrollWidth).toBeLessThanOrEqual(subtitle.clientWidth);
    await expect(canvas.getByRole('link', { name: /Status/ })).toBeVisible();
    await expectHoverRule();
  },
};

export const Schmal: StoryObj<UiStatusEntry> = {
  decorators: [withPhoneFrame],
  render: () => ({
    template: `
      <ui-status-entry variant="row" icon="router" kindTone="ok-container" title="Gewächshaus Nordseite" subtitle="Gateway online · Letzte Nachricht vor 3 Minuten" route="/mehr/gateways" />`,
  }),
  play: async ({ canvasElement }) => {
    await waitForTranslations();
    await expectNoHorizontalOverflow(canvasElement.querySelector('.story-narrow')!);
  },
};
