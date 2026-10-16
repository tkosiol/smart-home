import { provideRouter, withDisabledInitialNavigation } from '@angular/router';
import { applicationConfig, moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';
import { expect, userEvent } from 'storybook/test';
import { expectNoHorizontalOverflow, withNarrowFrame } from '../testing/story-helpers';
import { expectThemeMatrix, rgb } from '../testing/theme-matrix';
import { ThemeMatrixStoryComponent, UiMatrixCell } from '../testing/theme-matrix.story-component';
import { UiList } from './list';
import { UiListItem } from './list-item';

const meta: Meta<UiList> = {
  title: 'Inhalt/Liste',
  component: UiList,
  decorators: [
    // Storybook's iframe path matches no route; without this the router's initial navigation fails
    // and rewrites the URL, which breaks the second-theme check of the test runner.
    applicationConfig({ providers: [provideRouter([], withDisabledInitialNavigation())] }),
    moduleMetadata({ imports: [UiListItem] }),
  ],
};
export default meta;

const items = `
  <ui-list>
    <ui-list-item icon="palette" headline="Darstellung" supporting="Farben, Modus und Sprache" route="/darstellung" />
    <ui-list-item icon="notifications" headline="Benachrichtigungen" trailingText="kommt bald" disabled />
    <ui-list-item icon="sensors" headline="Gateways" route="/gateways" />
  </ui-list>`;

export const Mehr: StoryObj<UiList> = {
  render: () => ({ template: items }),
  play: async ({ canvas }) => {
    await expect(canvas.getAllByRole('listitem')).toHaveLength(3);
    await expect(canvas.getAllByRole('link')).toHaveLength(2);
    await userEvent.tab();
    await expect(canvas.getByRole('link', { name: /Darstellung/ })).toHaveFocus();
    await userEvent.tab();
    await expect(canvas.getByRole('link', { name: /Gateways/ })).toHaveFocus();
    const focused = canvas.getByRole('link', { name: /Gateways/ });
    await expect(getComputedStyle(focused).outlineStyle).toBe('solid');
    // A disabled row is dimmed by the token and carries no ARIA state on its div.
    const disabled = canvas.getByText('Benachrichtigungen').closest('.row')!;
    await expect(disabled.hasAttribute('aria-disabled')).toBe(false);
    await expect(getComputedStyle(disabled).opacity).toBe('0.38');
  },
};

export const Schmal: StoryObj<UiList> = {
  decorators: [withNarrowFrame],
  render: () => ({
    template: `<ui-list><ui-list-item icon="settings" headline="Benachrichtigungseinstellungsverwaltung" supporting="Donaudampfschifffahrtsgesellschaftskapitän" trailingText="kommt bald" disabled /></ui-list>`,
  }),
  play: async ({ canvasElement }) => {
    await expectNoHorizontalOverflow(canvasElement.querySelector('.story-narrow')!);
  },
};

/** Gateways (spec 3.6): online in ok-container, offline in error, unknown in offline-container. */
const gateways = `
  <ui-list>
    <ui-list-item icon="router" leadingTone="ok-container" headline="Gateway Garten" supporting="Online · vor 3 min" route="/gateways/garten" />
    <ui-list-item icon="router" leadingTone="error" headline="Gateway Keller" supporting="Offline · seit 40 min" route="/gateways/keller" />
    <ui-list-item icon="router" leadingTone="offline-container" headline="Gateway Dachboden" supporting="Noch keine Meldung" route="/gateways/dach" />
  </ui-list>`;

/** The "Mehr" page (spec 3.6): tonal icon containers in the Material roles. */
const more = `
  <ui-list>
    <ui-list-item icon="palette" leadingTone="primary-container" headline="Darstellung" supporting="Farben, Modus und Sprache" route="/darstellung" />
    <ui-list-item icon="group" leadingTone="secondary-container" headline="Mitglieder" route="/mitglieder" />
    <ui-list-item icon="extension" leadingTone="tertiary-container" headline="Erweiterungen" trailingText="kommt bald" disabled />
    <ui-list-item icon="settings" leadingTone="surface" headline="Einstellungen" route="/einstellungen" />
  </ui-list>`;

export const TonaleIcons: StoryObj<UiList> = {
  render: () => ({
    template: `<div style="display: grid; gap: 16px; max-width: 420px">${gateways}${more}</div>`,
  }),
  play: async ({ canvas, canvasElement }) => {
    const containers = [...canvasElement.querySelectorAll<HTMLElement>('.leading-container')];
    await expect(containers).toHaveLength(7);
    for (const container of containers) {
      const rect = container.getBoundingClientRect();
      await expect(rect.width).toBe(40);
      await expect(rect.height).toBe(40);
      await expect(getComputedStyle(container).borderRadius).toBe('9999px');
      await expect(container).toHaveAttribute('aria-hidden', 'true');
    }
    const root = getComputedStyle(document.documentElement);
    const offline = canvas
      .getByRole('link', { name: /Gateway Keller/ })
      .querySelector('.leading-container')!;
    await expect(getComputedStyle(offline).backgroundColor).toBe(
      rgb(root.getPropertyValue('--mat-sys-error').trim()),
    );
    await expect(getComputedStyle(offline.querySelector('ui-icon')!).color).toBe(
      rgb(root.getPropertyValue('--mat-sys-on-error').trim()),
    );
    // The icon is decorative: the link is named by its texts alone.
    await expect(
      canvas.getByRole('link', { name: 'Gateway Garten Online · vor 3 min' }),
    ).toBeVisible();
  },
};

export const Kombinationen: StoryObj<UiList> = {
  decorators: [moduleMetadata({ imports: [ThemeMatrixStoryComponent, UiMatrixCell] })],
  render: () => ({
    template: `
      <ui-theme-matrix>
        <ng-template uiMatrixCell>${gateways}${more}</ng-template>
      </ui-theme-matrix>`,
  }),
  play: async ({ canvasElement }) => {
    await expectThemeMatrix(canvasElement);
  },
};
