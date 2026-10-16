import { provideRouter, withDisabledInitialNavigation } from '@angular/router';
import { applicationConfig, moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';
import { expect, userEvent } from 'storybook/test';
import { UiDevicePod } from '../device-pod/device-pod';
import { UiPodRow } from '../device-pod/pod-row';
import { expectNoHorizontalOverflow, withPhoneFrame } from '../testing/story-helpers';
import { waitForTranslations } from '../testing/storybook-environment';
import { expectThemeMatrix, rgb } from '../testing/theme-matrix';
import { ThemeMatrixStoryComponent, UiMatrixCell } from '../testing/theme-matrix.story-component';
import { UiRoomCard } from './room-card';

const meta: Meta<UiRoomCard> = {
  title: 'Inhalt/Raumkarte',
  component: UiRoomCard,
  decorators: [
    // Storybook's iframe path matches no route; without this the router's initial navigation fails
    // and rewrites the URL, which breaks the second-theme check of the test runner.
    applicationConfig({ providers: [provideRouter([], withDisabledInitialNavigation())] }),
    moduleMetadata({ imports: [UiDevicePod, UiPodRow] }),
  ],
};
export default meta;

/** The living room of mockup B-Uebersicht: a lamp on, a lamp off, a plant in order. */
const pods = `
    <ui-pod-row wrap>
      <ui-device-pod kind="light" icon="lightbulb" value="80" unit="%" label="Deckenlampe · Warmweiß" [chip]="{ text: 'An', tone: 'primary' }" route="/geraete/decke" [pressed]="true" />
      <ui-device-pod kind="light" icon="lightbulb" value="Aus" label="Stehlampe" route="/geraete/steh" [pressed]="false" />
      <ui-device-pod kind="soil" icon="potted_plant" value="46" unit="%" label="Monstera · 22,1 °C" [chip]="{ text: 'OK', tone: 'ok' }" route="/geraete/monstera" />
    </ui-pod-row>`;

const calm = `
  <ui-room-card heading="Wohnzimmer" route="/raeume/wohnzimmer" [summary]="{ text: '3 Geräte · alles ok' }">${pods}
  </ui-room-card>`;

const withNotices = `
  <ui-room-card heading="Küche" route="/raeume/kueche" [summary]="{ text: '2 Hinweise', tone: 'dry' }">${pods}
  </ui-room-card>`;

export const Raum: StoryObj<UiRoomCard> = {
  render: () => ({ template: `<div style="max-width: 420px">${calm}</div>` }),
  play: async ({ canvas, canvasElement }) => {
    await waitForTranslations();
    const root = getComputedStyle(document.documentElement);
    const card = canvasElement.querySelector('ui-room-card')!;
    await expect(getComputedStyle(card).backgroundColor).toBe(
      rgb(root.getPropertyValue('--mat-sys-surface-container-low').trim()),
    );
    await expect(getComputedStyle(card).borderRadius).toBe(
      root.getPropertyValue('--mat-sys-corner-extra-large').trim(),
    );
    // The heading is the link, named by the room alone; the summary is plain text beside it.
    await expect(canvas.getByRole('heading', { level: 2 })).toHaveTextContent('Wohnzimmer');
    const link = canvas.getByRole('link', { name: 'Wohnzimmer' });
    await expect(link).toBeVisible();
    await expect(canvas.getByText('3 Geräte · alles ok')).toBeVisible();
    await userEvent.tab();
    await expect(link).toHaveFocus();
  },
};

export const Hinweise: StoryObj<UiRoomCard> = {
  render: () => ({ template: `<div style="max-width: 420px">${withNotices}</div>` }),
  play: async ({ canvas, canvasElement }) => {
    await waitForTranslations();
    const root = getComputedStyle(document.documentElement);
    const chip = canvas.getByText('2 Hinweise');
    await expect(getComputedStyle(chip).backgroundColor).toBe(
      rgb(root.getPropertyValue('--smart-status-dry-container').trim()),
    );
    await expect(canvasElement.querySelectorAll('ui-device-pod')).toHaveLength(3);
  },
};

/** Without a route the heading is plain; the pods wrap inside the card on a phone. */
export const Schmal: StoryObj<UiRoomCard> = {
  decorators: [withPhoneFrame],
  render: () => ({
    template: `<ui-room-card heading="Geräte" [summary]="{ text: '3 Geräte' }">${pods}</ui-room-card>`,
  }),
  play: async ({ canvas, canvasElement }) => {
    await waitForTranslations();
    await expect(canvas.queryByRole('link', { name: 'Geräte' })).toBeNull();
    await expectNoHorizontalOverflow(canvasElement.querySelector('.story-narrow')!);
  },
};

export const Kombinationen: StoryObj<UiRoomCard> = {
  decorators: [moduleMetadata({ imports: [ThemeMatrixStoryComponent, UiMatrixCell] })],
  render: () => ({
    template: `
      <ui-theme-matrix>
        <ng-template uiMatrixCell>${calm}${withNotices}</ng-template>
      </ui-theme-matrix>`,
  }),
  play: async ({ canvasElement }) => {
    await waitForTranslations();
    await expectThemeMatrix(canvasElement);
    for (const cell of canvasElement.querySelectorAll<HTMLElement>('.cell')) {
      const style = getComputedStyle(cell);
      for (const card of cell.querySelectorAll('ui-room-card')) {
        await expect(getComputedStyle(card).backgroundColor).toBe(
          rgb(style.getPropertyValue('--mat-sys-surface-container-low').trim()),
        );
      }
    }
  },
};
