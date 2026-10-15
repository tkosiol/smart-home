import { provideRouter, withDisabledInitialNavigation } from '@angular/router';
import { applicationConfig, moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';
import { expect } from 'storybook/test';
import { expectNoHorizontalOverflow, withNarrowFrame } from '../../testing/story-helpers';
import { expectThemeMatrix, rgb } from '../../testing/theme-matrix';
import {
  ThemeMatrixStoryComponent,
  UiMatrixCell,
} from '../../testing/theme-matrix.story-component';
import { UiSection } from '../section/section';
import { UiPage } from './page';

const meta: Meta<UiPage> = {
  title: 'Layout/Page',
  component: UiPage,
  decorators: [
    // The back button is a router link; without routes the initial navigation would rewrite the URL.
    applicationConfig({ providers: [provideRouter([], withDisabledInitialNavigation())] }),
    moduleMetadata({ imports: [UiSection] }),
  ],
};
export default meta;

const content = `
  <ui-page heading="Darstellung" description="So sieht die App für dich aus.">
    <ui-section heading="Farben" description="Grundfarbe und Variante.">
      <p>Inhalt</p>
    </ui-section>
    <ui-section heading="Unterabschnitt" [level]="3"><p>Mehr Inhalt</p></ui-section>
  </ui-page>`;

export const Standard: StoryObj<UiPage> = {
  render: () => ({ template: content }),
  play: async ({ canvas }) => {
    const heading = canvas.getByRole('heading', { level: 1, name: 'Darstellung' });
    await expect(heading).toBeVisible();
    // The app moves the focus here after a navigation.
    heading.focus();
    await expect(heading).toHaveFocus();
    await expect(canvas.getByRole('heading', { level: 2, name: 'Farben' })).toBeVisible();
    await expect(canvas.getByRole('heading', { level: 3, name: 'Unterabschnitt' })).toBeVisible();
  },
};

/**
 * The overview: the top app bar carries the title, so the h1 is for screen readers only. It stays
 * in the accessibility tree and takes no room: the content starts at the page's top padding.
 */
export const UeberschriftVersteckt: StoryObj<UiPage> = {
  render: () => ({
    template: `
      <ui-page heading="Übersicht" headingHidden>
        <ui-section heading="Geräte"><p data-testid="content">Inhalt</p></ui-section>
      </ui-page>`,
  }),
  play: async ({ canvas, canvasElement }) => {
    const heading = canvas.getByRole('heading', { level: 1, name: 'Übersicht' });
    await expect(heading).toBeInTheDocument();
    // Clipped to nothing, out of the flow, and still focusable for the app's focus move.
    await expect(getComputedStyle(heading).position).toBe('absolute');
    await expect(getComputedStyle(heading).clipPath).not.toBe('none');
    heading.focus();
    await expect(heading).toHaveFocus();
    const page = canvasElement.querySelector('ui-page')!;
    const padding = parseFloat(getComputedStyle(page).paddingTop);
    const section = canvas.getByRole('heading', { level: 2, name: 'Geräte' });
    await expect(
      Math.round(section.getBoundingClientRect().top - page.getBoundingClientRect().top),
    ).toBeLessThan(Math.round(padding) + 8);
    await expect(canvas.getByTestId('content')).toBeVisible();
  },
};

/**
 * A detail screen (spec 3.3, 3.4): the tonal back button before the title, the small line under
 * it, and sections whose headings are labels in the colour of their severity.
 */
const detail = `
  <ui-page heading="Alle Hinweise" description="5 offen · nach Dringlichkeit, dann neueste zuerst" backRoute="/" backLabel="Zur Übersicht">
    <ui-section heading="Kritisch" tone="error"><p>Inhalt</p></ui-section>
    <ui-section heading="Warnungen" tone="dry"><p>Inhalt</p></ui-section>
    <ui-section heading="Hinweise" tone="secondary"><p>Inhalt</p></ui-section>
  </ui-page>`;

export const MitZurueck: StoryObj<UiPage> = {
  render: () => ({ template: detail }),
  play: async ({ canvas }) => {
    const back = canvas.getByRole('link', { name: 'Zur Übersicht' });
    const heading = canvas.getByRole('heading', { level: 1, name: 'Alle Hinweise' });
    await expect(back).toBeVisible();
    await expect(back.getBoundingClientRect().width).toBe(48);
    // Button and title share a row; the title is bold.
    await expect(
      Math.abs(back.getBoundingClientRect().top - heading.getBoundingClientRect().top),
    ).toBeLessThan(24);
    await expect(getComputedStyle(heading).fontWeight).toBe('600');
    const root = getComputedStyle(document.documentElement);
    const critical = canvas.getByRole('heading', { level: 2, name: 'Kritisch' });
    await expect(getComputedStyle(critical).color).toBe(
      rgb(root.getPropertyValue('--mat-sys-error').trim()),
    );
    await expect(getComputedStyle(critical).textTransform).toBe('uppercase');
  },
};

export const Kombinationen: StoryObj<UiPage> = {
  decorators: [moduleMetadata({ imports: [ThemeMatrixStoryComponent, UiMatrixCell] })],
  render: () => ({
    template: `<ui-theme-matrix><ng-template uiMatrixCell>${detail}</ng-template></ui-theme-matrix>`,
  }),
  play: async ({ canvasElement }) => {
    await expectThemeMatrix(canvasElement);
  },
};

export const SchmalMitLangenWoertern: StoryObj<UiPage> = {
  decorators: [withNarrowFrame],
  render: () => ({
    template: `
      <ui-page heading="Bodenfeuchtigkeitsmessgerätekonfigurationsübersicht">
        <ui-section heading="Benachrichtigungseinstellungsverwaltungsbereich"><p>Donaudampfschifffahrtsgesellschaftskapitänsmütze</p></ui-section>
      </ui-page>`,
  }),
  play: async ({ canvasElement }) => {
    await expectNoHorizontalOverflow(canvasElement.querySelector('.story-narrow')!);
  },
};
