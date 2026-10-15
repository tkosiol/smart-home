import { provideRouter, withDisabledInitialNavigation } from '@angular/router';
import { applicationConfig, moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';
import { expect, userEvent } from 'storybook/test';
import { expectNoHorizontalOverflow, withPhoneFrame } from '../testing/story-helpers';
import { waitForTranslations } from '../testing/storybook-environment';
import { MATRIX_RED_SEED, expectThemeMatrix, rgb } from '../testing/theme-matrix';
import { ThemeMatrixStoryComponent, UiMatrixCell } from '../testing/theme-matrix.story-component';
import { UiStatusEntry } from './status-entry';
import { UiStatusHero } from './status-hero';

const meta: Meta<UiStatusHero> = {
  title: 'Inhalt/Status-Hero',
  component: UiStatusHero,
  decorators: [
    // Storybook's iframe path matches no route; without this the router's initial navigation fails
    // and rewrites the URL, which breaks the second-theme check of the test runner.
    applicationConfig({ providers: [provideRouter([], withDisabledInitialNavigation())] }),
    moduleMetadata({ imports: [UiStatusEntry] }),
  ],
};
export default meta;

/** The entries of mockup B-Status-Viele: 20 notices, two critical, three groups shown. */
const criticalEntries = `
    <ui-status-entry icon="router" kindTone="error" title="Gateway Garten offline" subtitle="12 Geräte nicht erreichbar · seit 40 min" severityLabel="Kritisch" route="/gateways/garten" />
    <ui-status-entry icon="wifi_off" kindTone="error" title="Sensor Keller meldet nicht" subtitle="Keller · zuletzt vor 6 h" severityLabel="Kritisch" route="/geraete/keller" />
    <ui-status-entry icon="water_drop" kindTone="dry-container" title="5 Pflanzen zu trocken" subtitle="Ficus, Efeutute, Farn, Gummibaum, Monstera" route="/hinweise" />`;

/** Only warnings and infos: a single device is shown directly (rule 2). */
const attentionEntries = `
    <ui-status-entry icon="water_drop" kindTone="dry-container" title="Ficus ist zu trocken" subtitle="Büro · vor 3 min" value="18 %" route="/geraete/ficus" />
    <ui-status-entry icon="warning" kindTone="warning-container" title="Batterie Küche schwach" subtitle="Grünlilie · vor 12 min" value="9 %" route="/geraete/gruenlilie" />
    <ui-status-entry icon="door_open" kindTone="secondary-container" title="Fenster Bad offen" subtitle="seit 25 min" route="/geraete/bad" />`;

/**
 * The three states (spec 4.1). `suffix` is appended to the heading: a page has one hero, the
 * matrix twelve, and region landmarks must stay unique.
 */
const critical = (suffix = "''") => `
  <ui-status-hero tone="critical" [heading]="'Braucht Aufmerksamkeit' + ${suffix}" [count]="20" [criticalCount]="2" moreLabel="3 weitere Gruppen" moreRoute="/hinweise">${criticalEntries}
  </ui-status-hero>`;

const attention = (suffix = "''") => `
  <ui-status-hero tone="attention" [heading]="'Braucht Aufmerksamkeit' + ${suffix}" [count]="3" moreRoute="/hinweise">${attentionEntries}
  </ui-status-hero>`;

/** Nothing open: the 56 px calm row (rule 7). */
const calm = `
  <ui-status-hero tone="calm" heading="Braucht Aufmerksamkeit" moreRoute="/hinweise">
    Gateway online · 9 Geräte · vor 3 min
  </ui-status-hero>`;

export const Kritisch: StoryObj<UiStatusHero> = {
  render: () => ({ template: `<div style="max-width: 420px">${critical()}</div>` }),
  play: async ({ canvas, canvasElement }) => {
    await waitForTranslations();
    const region = canvas.getByRole('region', { name: 'Braucht Aufmerksamkeit · 20' });
    await expect(region).toBeVisible();
    await expect(canvas.getByRole('heading', { level: 2 })).toHaveTextContent(
      'Braucht Aufmerksamkeit · 20',
    );
    await expect(canvas.getByText(/2 kritisch|2 critical/)).toBeVisible();
    const root = getComputedStyle(document.documentElement);
    await expect(getComputedStyle(region).backgroundColor).toBe(
      rgb(root.getPropertyValue('--mat-sys-error-container').trim()),
    );
    await expect(getComputedStyle(region).borderRadius).toBe(
      root.getPropertyValue('--mat-sys-corner-extra-large').trim(),
    );
    // Three entries plus the link to all notices, in DOM order; the link is at least 48 px.
    const links = canvas.getAllByRole('link');
    await expect(links).toHaveLength(4);
    await expect(links[0]).toHaveAccessibleName(
      'Gateway Garten offline 12 Geräte nicht erreichbar · seit 40 min Kritisch',
    );
    await expect(links[3]).toHaveAccessibleName(
      /(Alle 20 Hinweise|All 20 notices) 3 weitere Gruppen/,
    );
    await expect(links[3]!.getBoundingClientRect().height).toBeGreaterThanOrEqual(48);
    for (const entry of canvasElement.querySelectorAll('.entry')) {
      await expect(entry.getBoundingClientRect().height).toBeGreaterThanOrEqual(48);
      await expect(getComputedStyle(entry).borderRadius).toBe(
        root.getPropertyValue('--mat-sys-corner-large').trim(),
      );
    }
    await userEvent.tab();
    await expect(links[0]).toHaveFocus();
  },
};

export const Aufmerksamkeit: StoryObj<UiStatusHero> = {
  render: () => ({ template: `<div style="max-width: 420px">${attention()}</div>` }),
  play: async ({ canvas, canvasElement }) => {
    await waitForTranslations();
    const region = canvas.getByRole('region');
    const root = getComputedStyle(document.documentElement);
    await expect(getComputedStyle(region).backgroundColor).toBe(
      rgb(root.getPropertyValue('--mat-sys-primary-container').trim()),
    );
    await expect(canvas.queryByText(/kritisch|critical/)).toBeNull();
    // The value on the right takes the kind's strong colour.
    const value = canvasElement.querySelector('.value[data-tone="dry"]')!;
    await expect(getComputedStyle(value).color).toBe(
      rgb(root.getPropertyValue('--smart-status-dry').trim()),
    );
    await expect(canvas.getByRole('link', { name: /Alle 3 Hinweise|All 3 notices/ })).toBeVisible();
  },
};

/** The calm row is 56 px (rule 7) wherever its detail line fits; on 288 px it wraps and grows. */
export const Ruhe: StoryObj<UiStatusHero> = {
  render: () => ({ template: `<div style="max-width: 420px">${calm}</div>` }),
  play: async ({ canvas }) => {
    await waitForTranslations();
    const row = canvas.getByRole('link');
    await expect(row).toHaveAccessibleName(
      /(Alles in Ordnung|All is well) Gateway online · 9 Geräte · vor 3 min/,
    );
    await expect(row.getBoundingClientRect().height).toBe(56);
    await expect(canvas.getByRole('region')).toHaveAccessibleName(
      /(Alles in Ordnung|All is well) Gateway online · 9 Geräte · vor 3 min/,
    );
  },
};

export const Schmal: StoryObj<UiStatusHero> = {
  decorators: [withPhoneFrame],
  render: () => ({ template: `${critical()}${calm}` }),
  play: async ({ canvasElement }) => {
    await waitForTranslations();
    await expectNoHorizontalOverflow(canvasElement.querySelector('.story-narrow')!);
  },
};

/**
 * Review focus 4: with the red seed, `error` and `primary` move together; the theme engine then
 * gives both heroes the same container colour. The critical hero must still be told apart from
 * the attention hero beside it, so the difference never rests on colour alone (spec 8): the
 * critical count in its head and the "Kritisch" labels on its entries carry it. Both must stay
 * readable in every cell, dark + high contrast + red included (axe checks the contrast).
 */
export const Kombinationen: StoryObj<UiStatusHero> = {
  decorators: [moduleMetadata({ imports: [ThemeMatrixStoryComponent, UiMatrixCell] })],
  render: () => ({
    template: `
      <ui-theme-matrix>
        <ng-template uiMatrixCell let-cell>
          ${critical("' · ' + cell.title")}${attention("' · ' + cell.title")}
          <ui-status-hero tone="calm" heading="Braucht Aufmerksamkeit" moreRoute="/hinweise">
            Gateway online · 9 Geräte · {{ cell.title }}
          </ui-status-hero>
        </ng-template>
      </ui-theme-matrix>`,
  }),
  play: async ({ canvasElement }) => {
    await waitForTranslations();
    await expectThemeMatrix(canvasElement);
    for (const cell of canvasElement.querySelectorAll<HTMLElement>('.cell')) {
      const style = getComputedStyle(cell);
      const [critical, attention] = cell.querySelectorAll<HTMLElement>('ui-status-hero .hero');
      await expect(getComputedStyle(critical!).backgroundColor).toBe(
        rgb(style.getPropertyValue('--mat-sys-error-container').trim()),
      );
      await expect(getComputedStyle(attention!).backgroundColor).toBe(
        rgb(style.getPropertyValue('--mat-sys-primary-container').trim()),
      );
      await expect(critical!.querySelector('.critical')).not.toBeNull();
      await expect(critical!.querySelectorAll('.severity')).toHaveLength(2);
      await expect(attention!.querySelector('.critical')).toBeNull();
      await expect(attention!.querySelector('.severity')).toBeNull();
    }
    const redDarkHigh = canvasElement.querySelector<HTMLElement>(
      `.cell[data-seed="${MATRIX_RED_SEED}"][data-mode="dark"][data-contrast="high"]`,
    )!;
    await expect(redDarkHigh).not.toBeNull();
    // Even where both containers coincide, the critical count stays visible in the critical head.
    await expect(redDarkHigh.querySelector('.critical')?.textContent?.trim()).toMatch(
      /2 kritisch|2 critical/,
    );
  },
};
