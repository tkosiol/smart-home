import { provideRouter, withDisabledInitialNavigation } from '@angular/router';
import { applicationConfig, moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';
import { expect, userEvent } from 'storybook/test';
import { expectNoHorizontalOverflow, withNarrowFrame } from '../testing/story-helpers';
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
