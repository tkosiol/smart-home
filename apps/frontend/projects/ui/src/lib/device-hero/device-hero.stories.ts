import { moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';
import { expect } from 'storybook/test';
import { UiProgressBand } from '../progress-band/progress-band';
import { UiStatusChip } from '../status-chip/status-chip';
import { expectNoHorizontalOverflow, withPhoneFrame } from '../testing/story-helpers';
import { expectThemeMatrix, rgb } from '../testing/theme-matrix';
import { ThemeMatrixStoryComponent, UiMatrixCell } from '../testing/theme-matrix.story-component';
import { UiValueDisplay } from '../value-display/value-display';
import { UiDeviceHero } from './device-hero';

const meta: Meta<UiDeviceHero> = {
  title: 'Status/Geräte-Hero',
  component: UiDeviceHero,
  decorators: [moduleMetadata({ imports: [UiProgressBand, UiStatusChip, UiValueDisplay] })],
};
export default meta;

/** The hero of a soil sensor (spec 3.3): label and chip, the value, the band, the update line. */
const soil = `
  <ui-device-hero kind="soil" label="Bodenfeuchte" note="Aktualisiert vor 3 Minuten">
    <ui-status-chip text="trocken" tone="dry" />
    <ui-value-display size="hero" value="18" unit="%" />
    <ui-progress-band label="Bodenfeuchte" [value]="18" [band]="{ from: 25, to: 60, tone: 'ok' }" valueText="18 Prozent, zu trocken. Zielbereich 25 bis 60 Prozent." />
  </ui-device-hero>`;

const kinds = `
  ${soil}
  <ui-device-hero kind="climate" label="Temperatur" note="Aktualisiert vor 1 Minute">
    <ui-value-display size="hero" value="21,5" unit="°C" />
  </ui-device-hero>
  <ui-device-hero kind="light" label="Helligkeit" note="Aktualisiert gerade eben">
    <ui-status-chip text="An" tone="primary" />
    <ui-value-display size="hero" value="80" unit="%" />
  </ui-device-hero>
  <ui-device-hero kind="contact" label="Zustand" note="Aktualisiert vor 2 Stunden">
    <ui-status-chip text="Offline" tone="error" />
    <ui-value-display size="hero" value="Offen" />
  </ui-device-hero>
  <ui-device-hero kind="other" label="Signalqualität">
    <ui-value-display size="hero" value="–" />
  </ui-device-hero>`;

export const Arten: StoryObj<UiDeviceHero> = {
  render: () => ({
    template: `<div style="display: grid; gap: 16px; max-width: 480px">${kinds}</div>`,
  }),
  play: async ({ canvas, canvasElement }) => {
    const heroes = canvasElement.querySelectorAll<HTMLElement>('ui-device-hero');
    await expect(heroes).toHaveLength(5);
    const root = getComputedStyle(document.documentElement);
    const [soilHero, climate, light, , other] = heroes;
    await expect(getComputedStyle(soilHero!).backgroundColor).toBe(
      rgb(root.getPropertyValue('--mat-sys-tertiary-container').trim()),
    );
    await expect(getComputedStyle(climate!).backgroundColor).toBe(
      rgb(root.getPropertyValue('--mat-sys-secondary-container').trim()),
    );
    await expect(getComputedStyle(light!).backgroundColor).toBe(
      rgb(root.getPropertyValue('--mat-sys-primary-container').trim()),
    );
    await expect(getComputedStyle(other!).backgroundColor).toBe(
      rgb(root.getPropertyValue('--mat-sys-surface-container-high').trim()),
    );
    await expect(getComputedStyle(soilHero!).borderRadius).toBe(
      root.getPropertyValue('--mat-sys-corner-extra-large').trim(),
    );
    // Label, chip, value and note read in this order (the parts have no space between them in
    // the DOM); the chip is a container of its status colour.
    await expect(soilHero!.textContent?.replace(/\s+/g, '')).toBe(
      'Bodenfeuchtetrocken18%Aktualisiertvor3Minuten',
    );
    await expect(getComputedStyle(canvas.getByText('trocken')).backgroundColor).toBe(
      rgb(root.getPropertyValue('--smart-status-dry-container').trim()),
    );
    await expect(canvas.getByRole('meter', { name: 'Bodenfeuchte' })).toBeVisible();
  },
};

export const Schmal: StoryObj<UiDeviceHero> = {
  decorators: [withPhoneFrame],
  render: () => ({ template: soil }),
  play: async ({ canvasElement }) => {
    await expectNoHorizontalOverflow(canvasElement.querySelector('.story-narrow')!);
  },
};

export const Kombinationen: StoryObj<UiDeviceHero> = {
  decorators: [moduleMetadata({ imports: [ThemeMatrixStoryComponent, UiMatrixCell] })],
  render: () => ({
    template: `
      <ui-theme-matrix>
        <ng-template uiMatrixCell>
          <div style="display: grid; gap: 16px">${kinds}</div>
        </ng-template>
      </ui-theme-matrix>`,
  }),
  play: async ({ canvasElement }) => {
    await expectThemeMatrix(canvasElement);
  },
};
