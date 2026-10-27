import { moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';
import { expect } from 'storybook/test';
import { UiButton } from '../button/button';
import { UiSkeleton } from '../skeleton/skeleton';
import { expectThemeMatrix, rgb } from '../testing/theme-matrix';
import { ThemeMatrixStoryComponent, UiMatrixCell } from '../testing/theme-matrix.story-component';
import { UiFigure } from './figure';

const meta: Meta<UiFigure> = {
  title: 'Inhalt/Figur',
  component: UiFigure,
  decorators: [moduleMetadata({ imports: [UiButton, UiSkeleton] })],
};
export default meta;

/** Stands in for a chart: a block at the chart's height. */
const plot = `<div class="plot" style="height: var(--smart-size-chart); border-radius: var(--mat-sys-corner-medium); background: var(--mat-sys-surface-container-high)"></div>`;

export const Beschriftung: StoryObj<UiFigure> = {
  render: () => ({
    template: `
      <div style="max-width: 420px">
        <ui-figure caption="Tief 20 % · Hoch 55 % · 24 Std. zu trocken · 4× gegossen">${plot}</ui-figure>
      </div>`,
  }),
  play: async ({ canvasElement }) => {
    const figure = canvasElement.querySelector('figure')!;
    const caption = figure.querySelector('figcaption')!;
    const root = getComputedStyle(document.documentElement);
    await expect(caption.textContent).toContain('Tief 20 %');
    await expect(getComputedStyle(caption).color).toBe(
      rgb(root.getPropertyValue('--mat-sys-on-surface-variant').trim()),
    );
    await expect(getComputedStyle(caption).fontVariantNumeric).toBe('tabular-nums');
    // The caption sits right under the plot, a small gap apart.
    const plotRect = figure.querySelector('.plot')!.getBoundingClientRect();
    await expect(caption.getBoundingClientRect().top - plotRect.bottom).toBe(8);
  },
};

/** While loading, a skeleton takes the chart's place; the figure stays as tall as with a caption. */
export const Laden: StoryObj<UiFigure> = {
  render: () => ({
    template: `
      <div style="display: grid; gap: 16px; max-width: 420px">
        <ui-figure caption="Tief 20 % · Hoch 55 %">${plot}</ui-figure>
        <div role="status" aria-label="Lädt" aria-busy="true"><ui-figure><ui-skeleton variant="chart" /></ui-figure></div>
      </div>`,
  }),
  play: async ({ canvasElement }) => {
    const [ready, loading] = [...canvasElement.querySelectorAll('figure')].map(
      (figure) => figure.getBoundingClientRect().height,
    );
    await expect(loading).toBe(ready);
  },
};

/** A message where the chart would be; the content beneath it is then an action. */
export const Nachricht: StoryObj<UiFigure> = {
  render: () => ({
    template: `
      <div style="display: grid; gap: 16px; max-width: 420px">
        <ui-figure message="Noch keine Messwerte in diesem Zeitraum" />
        <ui-figure message="Der Verlauf konnte nicht geladen werden.">
          <ui-button variant="tonal">Erneut versuchen</ui-button>
        </ui-figure>
      </div>`,
  }),
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByText('Noch keine Messwerte in diesem Zeitraum')).toBeVisible();
    const button = canvas.getByRole('button', { name: 'Erneut versuchen' });
    await expect(button).toBeVisible();
    const root = getComputedStyle(document.documentElement);
    const bodies = canvasElement.querySelectorAll<HTMLElement>('.body--message');
    await expect(bodies).toHaveLength(2);
    for (const body of bodies) {
      const large = body.closest('ui-figure')!.hasAttribute('data-large');
      await expect(getComputedStyle(body).height).toBe(
        root.getPropertyValue(large ? '--smart-size-chart-large' : '--smart-size-chart').trim(),
      );
    }
    // The action stands under the message, both centred in the box.
    const message = bodies[1]!.querySelector('.message')!.getBoundingClientRect();
    const action = button.getBoundingClientRect();
    await expect(action.top).toBeGreaterThan(message.bottom);
    await expect(
      Math.abs(action.left + action.width / 2 - (message.left + message.width / 2)),
    ).toBeLessThan(2);
  },
};

export const Kombinationen: StoryObj<UiFigure> = {
  decorators: [moduleMetadata({ imports: [ThemeMatrixStoryComponent, UiMatrixCell] })],
  render: () => ({
    template: `
      <ui-theme-matrix>
        <ng-template uiMatrixCell>
          <ui-figure message="Der Verlauf konnte nicht geladen werden." caption="Tief 20 % · Hoch 55 %">
            <ui-button variant="tonal">Erneut versuchen</ui-button>
          </ui-figure>
        </ng-template>
      </ui-theme-matrix>`,
  }),
  play: async ({ canvasElement }) => {
    await expectThemeMatrix(canvasElement);
  },
};
