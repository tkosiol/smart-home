import { moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';
import { expect } from 'storybook/test';
import { expectNoHorizontalOverflow, withNarrowFrame } from '../../testing/story-helpers';
import { UiSection } from '../section/section';
import { UiPage } from './page';

const meta: Meta<UiPage> = {
  title: 'Layout/Page',
  component: UiPage,
  decorators: [moduleMetadata({ imports: [UiSection] })],
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
