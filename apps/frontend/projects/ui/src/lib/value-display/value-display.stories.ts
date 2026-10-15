import { moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';
import { expect } from 'storybook/test';
import { expectNoHorizontalOverflow, withPhoneFrame } from '../testing/story-helpers';
import { expectThemeMatrix, rgb } from '../testing/theme-matrix';
import { ThemeMatrixStoryComponent, UiMatrixCell } from '../testing/theme-matrix.story-component';
import { UiValueDisplay } from './value-display';

const meta: Meta<UiValueDisplay> = {
  title: 'Inhalt/Wert',
  component: UiValueDisplay,
  args: { value: '21,8', unit: '°C', label: 'Temperatur', size: 'medium' },
};
export default meta;

/** The hero value sits on the device page's card in the device kind's colour (spec 3.3). */
const soilHero = `
  <div style="padding: 24px; border-radius: var(--smart-shape-card); background: var(--mat-sys-tertiary-container); color: var(--mat-sys-on-tertiary-container)">
    <ui-value-display size="hero" value="18" unit="%" label="Bodenfeuchte" />
  </div>`;

export const Groessen: StoryObj<UiValueDisplay> = {
  render: () => ({
    template: `
      <div style="display: grid; gap: 16px; max-width: 420px">
        ${soilHero}
        <ui-value-display size="large" value="80" unit="%" label="Helligkeit" />
        <div style="display: flex; gap: 8px">
          <ui-value-display value="21,8" unit="°C" label="Temperatur" />
          <ui-value-display value="72" unit="%" label="Batterie" />
          <ui-value-display value="Gut" label="Signal" />
        </div>
      </div>`,
  }),
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByText('Bodenfeuchte')).toBeVisible();
    await expect(canvas.getByText('Gut')).toBeVisible();
    await expect(canvas.queryByRole('heading')).toBeNull();
    const hero = canvasElement.querySelector('[data-size="hero"] .value')!;
    await expect(getComputedStyle(hero).fontSize).toBe('80px');
    await expect(getComputedStyle(hero).lineHeight).toBe('84px');
    await expect(getComputedStyle(hero).fontWeight).toBe('600');
    for (const value of canvasElement.querySelectorAll('.value')) {
      await expect(getComputedStyle(value).fontVariantNumeric).toBe('tabular-nums');
    }
    // The label inherits the surface's on-colour, like the value, and precedes it in the hero.
    const heroLabel = canvasElement.querySelector('[data-size="hero"] .label')!;
    await expect(getComputedStyle(heroLabel).color).toBe(getComputedStyle(hero).color);
    await expect(heroLabel.compareDocumentPosition(hero) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  },
};

export const Toene: StoryObj<UiValueDisplay> = {
  render: () => ({
    template: `
      <div style="display: flex; flex-wrap: wrap; gap: 16px">
        <ui-value-display tone="dry" value="18" unit="%" label="zu trocken" />
        <ui-value-display tone="wet" value="82" unit="%" label="zu nass" />
        <ui-value-display tone="ok" value="46" unit="%" label="in Ordnung" />
        <ui-value-display tone="warning" value="9" unit="%" label="Batterie" />
        <ui-value-display tone="error" value="6" unit="h" label="keine Meldung" />
        <ui-value-display tone="primary" value="3" label="Geräte" />
      </div>`,
  }),
  play: async ({ canvasElement }) => {
    const dry = canvasElement.querySelector('[data-tone="dry"]')!;
    const expected = getComputedStyle(document.documentElement)
      .getPropertyValue('--smart-status-dry')
      .trim();
    await expect(getComputedStyle(dry.querySelector('.value')!).color).toBe(rgb(expected));
    await expect(getComputedStyle(dry.querySelector('.label')!).color).toBe(rgb(expected));
  },
};

export const Schmal: StoryObj<UiValueDisplay> = {
  decorators: [withPhoneFrame],
  render: () => ({
    template: `
      <div style="padding: 24px; border-radius: var(--smart-shape-card); background: var(--mat-sys-tertiary-container); color: var(--mat-sys-on-tertiary-container)">
        <ui-value-display size="hero" value="1234,5" unit="hPa" label="Luftdruckmessung im Gewächshaus" />
      </div>`,
  }),
  play: async ({ canvasElement }) => {
    await expectNoHorizontalOverflow(canvasElement.querySelector('.story-narrow')!);
  },
};

export const Kombinationen: StoryObj<UiValueDisplay> = {
  decorators: [moduleMetadata({ imports: [ThemeMatrixStoryComponent, UiMatrixCell] })],
  render: () => ({
    template: `
      <ui-theme-matrix>
        <ng-template uiMatrixCell>
          ${soilHero}
          <div style="display: flex; gap: 12px">
            <ui-value-display tone="dry" value="18" unit="%" label="zu trocken" />
            <ui-value-display tone="warning" value="9" unit="%" label="Batterie" />
            <ui-value-display value="21,8" unit="°C" label="Temperatur" />
          </div>
          <div style="display: flex; gap: 8px">
            <div style="flex: 1; padding: 14px; border-radius: var(--smart-shape-pod); background: var(--mat-sys-primary); color: var(--mat-sys-on-primary)">
              <ui-value-display value="80" unit="%" label="Deckenlampe · An" />
            </div>
            <div style="flex: 1; padding: 14px; border-radius: var(--smart-shape-pod); background: var(--mat-sys-secondary-container); color: var(--mat-sys-on-secondary-container)">
              <ui-value-display value="21,4" unit="°C" label="Klima · 48 %" />
            </div>
          </div>
        </ng-template>
      </ui-theme-matrix>`,
  }),
  play: async ({ canvasElement }) => {
    await expectThemeMatrix(canvasElement);
  },
};
