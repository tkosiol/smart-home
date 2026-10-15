import { moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';
import { expect } from 'storybook/test';
import { expectNoHorizontalOverflow, withPhoneFrame } from '../testing/story-helpers';
import { expectThemeMatrix, rgb } from '../testing/theme-matrix';
import { ThemeMatrixStoryComponent, UiMatrixCell } from '../testing/theme-matrix.story-component';
import { UiValueDisplay } from '../value-display/value-display';
import { UiProgressBand } from './progress-band';

const meta: Meta<UiProgressBand> = {
  title: 'Inhalt/Fortschrittsband',
  component: UiProgressBand,
  decorators: [moduleMetadata({ imports: [UiValueDisplay] })],
  args: {
    label: 'Bodenfeuchte',
    value: 18,
    min: 0,
    max: 100,
    band: { from: 0, to: 25, tone: 'dry' },
    valueText: '18 Prozent, zu trocken',
  },
};
export default meta;

/** The hero of a soil sensor: value, band and caption (spec 3.3). */
const soilHero = (value: number, text: string) => `
  <div style="display: grid; gap: 16px; padding: 24px; border-radius: var(--smart-shape-card); background: var(--mat-sys-tertiary-container); color: var(--mat-sys-on-tertiary-container)">
    <ui-value-display size="hero" value="${value}" unit="%" label="Bodenfeuchte" />
    <ui-progress-band label="Bodenfeuchte" [value]="${value}" [band]="{ from: 0, to: 25, tone: 'dry' }" valueText="${text}" />
    <span style="font: var(--mat-sys-body-small)">Zu trocken unter 25 % · aktualisiert vor 3 min</span>
  </div>`;

export const Standard: StoryObj<UiProgressBand> = {
  render: () => ({
    template: `
      <div style="display: grid; gap: 16px; max-width: 420px">
        ${soilHero(18, '18 Prozent, zu trocken')}
        <ui-progress-band label="Bodenfeuchte Monstera" [value]="46" [band]="{ from: 0, to: 25, tone: 'dry' }" valueText="46 Prozent, in Ordnung" />
        <ui-progress-band label="Batterie" [value]="72" valueText="72 Prozent" />
      </div>`,
  }),
  play: async ({ canvas, canvasElement }) => {
    const meters = canvas.getAllByRole('meter');
    await expect(meters).toHaveLength(3);
    const dry = canvas.getByRole('meter', { name: 'Bodenfeuchte' });
    await expect(dry).toHaveAttribute('aria-valuenow', '18');
    await expect(dry).toHaveAttribute('aria-valuetext', '18 Prozent, zu trocken');
    const track = dry.getBoundingClientRect();
    const fill = dry.querySelector('.fill')!.getBoundingClientRect();
    await expect(Math.round(fill.width)).toBe(Math.round(track.width * 0.18));
    await expect(track.height).toBe(12);
    const root = getComputedStyle(document.documentElement);
    await expect(getComputedStyle(dry.querySelector('.fill')!).backgroundColor).toBe(
      rgb(root.getPropertyValue('--smart-status-dry').trim()),
    );
    await expect(getComputedStyle(dry.querySelector('.band')!).backgroundColor).toBe(
      rgb(root.getPropertyValue('--smart-status-dry-container').trim()),
    );
    // Outside the band the fill is primary; without a band there is no band element.
    const ok = canvas.getByRole('meter', { name: 'Bodenfeuchte Monstera' });
    await expect(getComputedStyle(ok.querySelector('.fill')!).backgroundColor).toBe(
      rgb(root.getPropertyValue('--mat-sys-primary').trim()),
    );
    await expect(canvasElement.querySelectorAll('.band')).toHaveLength(2);
  },
};

export const ObererBereich: StoryObj<UiProgressBand> = {
  render: () => ({
    template: `
      <div style="display: grid; gap: 16px; max-width: 420px">
        <ui-progress-band label="Bodenfeuchte" [value]="72" [band]="{ from: 60, to: 100, tone: 'wet' }" valueText="72 Prozent, zu nass" />
        <ui-progress-band label="Luftfeuchte" [value]="55" [min]="30" [max]="80" [band]="{ from: 40, to: 60, tone: 'ok' }" valueText="55 Prozent, im Zielbereich" />
      </div>`,
  }),
  play: async ({ canvas }) => {
    const wet = canvas.getByRole('meter', { name: 'Bodenfeuchte' });
    const band = wet.querySelector('.band')!.getBoundingClientRect();
    const track = wet.getBoundingClientRect();
    await expect(Math.round(band.left - track.left)).toBe(Math.round(track.width * 0.6));
    await expect(wet.querySelector('.fill')).toHaveAttribute('data-tone', 'wet');
    const humidity = canvas.getByRole('meter', { name: 'Luftfeuchte' });
    await expect(humidity).toHaveAttribute('aria-valuemin', '30');
    await expect(humidity).toHaveAttribute('aria-valuemax', '80');
    await expect(humidity.querySelector('.fill')).toHaveAttribute('data-tone', 'ok');
  },
};

export const Schmal: StoryObj<UiProgressBand> = {
  decorators: [withPhoneFrame],
  render: () => ({ template: soilHero(18, '18 Prozent, zu trocken') }),
  play: async ({ canvasElement }) => {
    await expectNoHorizontalOverflow(canvasElement.querySelector('.story-narrow')!);
  },
};

export const Kombinationen: StoryObj<UiProgressBand> = {
  decorators: [moduleMetadata({ imports: [ThemeMatrixStoryComponent, UiMatrixCell] })],
  render: () => ({
    template: `
      <ui-theme-matrix>
        <ng-template uiMatrixCell>
          ${soilHero(18, '18 Prozent, zu trocken')}
          <ui-progress-band label="Bodenfeuchte Monstera" [value]="46" [band]="{ from: 0, to: 25, tone: 'dry' }" valueText="46 Prozent, in Ordnung" />
          <ui-progress-band label="Bodenfeuchte Farn" [value]="72" [band]="{ from: 60, to: 100, tone: 'wet' }" valueText="72 Prozent, zu nass" />
        </ng-template>
      </ui-theme-matrix>`,
  }),
  play: async ({ canvasElement }) => {
    await expectThemeMatrix(canvasElement);
  },
};
