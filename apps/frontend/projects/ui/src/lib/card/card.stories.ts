import { moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';
import { expect } from 'storybook/test';
import { UiButton } from '../button/button';
import { expectNoHorizontalOverflow, withNarrowFrame } from '../testing/story-helpers';
import { expectThemeMatrix, rgb } from '../testing/theme-matrix';
import { ThemeMatrixStoryComponent, UiMatrixCell } from '../testing/theme-matrix.story-component';
import { UiCard, UiCardActions } from './card';

const meta: Meta<UiCard> = {
  title: 'Inhalt/Card',
  component: UiCard,
  decorators: [moduleMetadata({ imports: [UiCardActions, UiButton] })],
};
export default meta;

export const Varianten: StoryObj<UiCard> = {
  render: () => ({
    template: `
      <div style="display: grid; gap: 16px; max-width: 480px">
        <ui-card heading="Umrandet" description="Standard"><p>Inhalt</p></ui-card>
        <ui-card variant="filled" heading="Gefüllt"><p>Inhalt</p></ui-card>
        <ui-card variant="elevated" heading="Erhöht">
          <p>Inhalt</p>
          <div uiCardActions><ui-button variant="text">Details</ui-button></div>
        </ui-card>
        <ui-card variant="low" heading="Grenzwerte" description="Ab diesen Werten meldet die App einen Hinweis."><p>Inhalt</p></ui-card>
        <ui-card variant="accent" heading="Neu erkannt" description="Diese Geräte hat ein Gateway gemeldet."><p>Inhalt</p></ui-card>
      </div>`,
  }),
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByRole('heading', { level: 3, name: 'Umrandet' })).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Details' })).toBeVisible();
    await expect(canvas.getAllByRole('heading', { level: 3 })).toHaveLength(5);
    // The card of the design concept: surface-container-low with extra-large corners.
    const root = getComputedStyle(document.documentElement);
    const low = canvasElement.querySelector('ui-card[variant="low"] mat-card')!;
    await expect(getComputedStyle(low).backgroundColor).toBe(
      rgb(root.getPropertyValue('--mat-sys-surface-container-low').trim()),
    );
    await expect(getComputedStyle(low).borderRadius).toBe(
      root.getPropertyValue('--mat-sys-corner-extra-large').trim(),
    );
    await expect(
      getComputedStyle(canvas.getByRole('heading', { name: 'Grenzwerte' })).fontWeight,
    ).toBe('600');
    // The accent card: secondary-container with its on-colour on the texts.
    const accent = canvasElement.querySelector('ui-card[variant="accent"] mat-card')!;
    await expect(getComputedStyle(accent).backgroundColor).toBe(
      rgb(root.getPropertyValue('--mat-sys-secondary-container').trim()),
    );
    await expect(getComputedStyle(canvas.getByRole('heading', { name: 'Neu erkannt' })).color).toBe(
      rgb(root.getPropertyValue('--mat-sys-on-secondary-container').trim()),
    );
  },
};

export const Kombinationen: StoryObj<UiCard> = {
  decorators: [moduleMetadata({ imports: [ThemeMatrixStoryComponent, UiMatrixCell] })],
  render: () => ({
    template: `
      <ui-theme-matrix>
        <ng-template uiMatrixCell>
          <div style="display: grid; gap: 16px">
            <ui-card variant="low" heading="Grenzwerte" description="Ab diesen Werten meldet die App einen Hinweis.">
              <p>Inhalt</p>
              <div uiCardActions><ui-button variant="text">Auf Standard zurücksetzen</ui-button></div>
            </ui-card>
            <ui-card variant="accent" heading="Neu erkannt" description="Diese Geräte hat ein Gateway gemeldet.">
              <p>Inhalt</p>
              <div uiCardActions><ui-button>Hinzufügen</ui-button></div>
            </ui-card>
          </div>
        </ng-template>
      </ui-theme-matrix>`,
  }),
  play: async ({ canvasElement }) => {
    await expectThemeMatrix(canvasElement);
  },
};

export const Ueberschriftenebene: StoryObj<UiCard> = {
  render: () => ({
    template: `<ui-card heading="Auf Ebene 2" [level]="2"><p>Inhalt</p></ui-card>`,
  }),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('heading', { level: 2, name: 'Auf Ebene 2' })).toBeVisible();
  },
};

export const Schmal: StoryObj<UiCard> = {
  decorators: [withNarrowFrame],
  render: () => ({
    template: `<ui-card heading="Bodenfeuchtigkeitssensorkalibrierungsergebnis"><p>Donaudampfschifffahrtsgesellschaft</p></ui-card>`,
  }),
  play: async ({ canvasElement }) => {
    await expectNoHorizontalOverflow(canvasElement.querySelector('.story-narrow')!);
  },
};
