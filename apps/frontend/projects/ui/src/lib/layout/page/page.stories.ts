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
    await expect(canvas.getByRole('heading', { level: 1, name: 'Darstellung' })).toBeVisible();
    await expect(canvas.getByRole('heading', { level: 2, name: 'Farben' })).toBeVisible();
    await expect(canvas.getByRole('heading', { level: 3, name: 'Unterabschnitt' })).toBeVisible();
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
