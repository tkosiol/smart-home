import { moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';
import { expect, waitFor } from 'storybook/test';
import { expectNoHorizontalOverflow, withPhoneFrame } from '../testing/story-helpers';
import { expectThemeMatrix, rgb } from '../testing/theme-matrix';
import { ThemeMatrixStoryComponent, UiMatrixCell } from '../testing/theme-matrix.story-component';
import { UiValueTable, type UiTableRow } from './value-table';

const hours: UiTableRow[] = Array.from({ length: 36 }, (_, index) => {
  const hour = 14 - index;
  const day = hour >= 0 ? 'Di., 27. Okt.' : 'Mo., 26. Okt.';
  const h = ((hour % 24) + 24) % 24;
  return {
    key: `h${index}`,
    cells: [`${day}, ${h}–${h + 1} Uhr`, `${42 - Math.round(index / 3)} %`],
  };
});

const days: UiTableRow[] = [
  { key: 'd0', cells: ['Di., 27. Okt.', '43 %', '42–45 %'] },
  { key: 'd1', cells: ['Mo., 26. Okt.', '47 %', '44–50 %'] },
  { key: 'd2', cells: ['So., 25. Okt.', '52 %', '49–55 %'] },
  {
    key: 'd3',
    cells: ['Sa., 24. Okt.', '30 %', '20–56 %'],
    note: 'zeitweise zu trocken · gegossen',
  },
  { key: 'd4', cells: ['Fr., 23. Okt.', '22 %', '20–24 %'], note: 'zeitweise zu trocken' },
  { key: 'd5', cells: ['Do., 22. Okt.', '27 %', '25–29 %'] },
  { key: 'd6', cells: ['Mi., 21. Okt.', '32 %', '30–34 %'] },
  { key: 'd7', cells: ['Di., 20. Okt.', '37 %', '35–39 %'] },
];

const meta: Meta<UiValueTable> = {
  title: 'Inhalt/Wertetabelle',
  component: UiValueTable,
  args: {
    columns: [{ label: 'Zeit' }, { label: 'Bodenfeuchte' }],
    rows: hours,
    label: 'Bodenfeuchte, letzte 7 Tage',
  },
};
export default meta;

/** Hourly values, newest first: the header row stays in view while the rows scroll. */
export const Stunden: StoryObj<UiValueTable> = {
  render: (args) => ({
    props: args,
    template: `<div style="max-width: 420px"><ui-value-table [columns]="columns" [rows]="rows" [label]="label" /></div>`,
  }),
  play: async ({ canvas, canvasElement }) => {
    const region = canvas.getByRole('group', { name: 'Bodenfeuchte, letzte 7 Tage' });
    await expect(region).toHaveAttribute('tabindex', '0');
    await expect(canvas.getAllByRole('row')).toHaveLength(37);
    const root = getComputedStyle(document.documentElement);
    await expect(getComputedStyle(region).backgroundColor).toBe(
      rgb(root.getPropertyValue('--mat-sys-surface-container-lowest').trim()),
    );
    const large = region.closest('ui-value-table')!.hasAttribute('data-large');
    await expect(getComputedStyle(region).height).toBe(
      root.getPropertyValue(large ? '--smart-size-chart-large' : '--smart-size-chart').trim(),
    );
    // Scrolled down, the header still sits at the top of the box.
    region.scrollTop = 400;
    const header = canvasElement.querySelector('th')!;
    await waitFor(async () => {
      await expect(region.scrollTop).toBeGreaterThan(0);
      await expect(
        Math.abs(header.getBoundingClientRect().top - region.getBoundingClientRect().top),
      ).toBeLessThan(1);
    });
  },
};

/** Daily values over 4 weeks: mean, low to high, and a note on days that were dry or watered. */
export const Tage: StoryObj<UiValueTable> = {
  args: {
    columns: [{ label: 'Tag' }, { label: 'Mittel' }, { label: 'Tief–Hoch' }],
    rows: days,
    label: 'Bodenfeuchte, letzte 4 Wochen',
  },
  render: (args) => ({
    props: args,
    template: `<div style="max-width: 420px"><ui-value-table [columns]="columns" [rows]="rows" [label]="label" /></div>`,
  }),
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByText('zeitweise zu trocken · gegossen')).toBeVisible();
    const cells = canvasElement.querySelectorAll('tbody tr:first-child td');
    await expect(getComputedStyle(cells[0]!).textAlign).toBe('start');
    await expect(getComputedStyle(cells[1]!).textAlign).toBe('end');
    await expect(getComputedStyle(cells[2]!).textAlign).toBe('end');
  },
};

export const Schmal: StoryObj<UiValueTable> = {
  ...Tage,
  decorators: [withPhoneFrame],
  render: (args) => ({
    props: args,
    template: `<ui-value-table [columns]="columns" [rows]="rows" [label]="label" />`,
  }),
  play: async ({ canvasElement }) => {
    await expectNoHorizontalOverflow(canvasElement.querySelector('.story-narrow')!);
    await expectNoHorizontalOverflow(canvasElement.querySelector('.scroll')!);
  },
};

export const Kombinationen: StoryObj<UiValueTable> = {
  args: Tage.args,
  decorators: [moduleMetadata({ imports: [ThemeMatrixStoryComponent, UiMatrixCell] })],
  render: (args) => ({
    props: args,
    template: `
      <ui-theme-matrix>
        <ng-template uiMatrixCell>
          <ui-value-table [columns]="columns" [rows]="rows" [label]="label" />
        </ng-template>
      </ui-theme-matrix>`,
  }),
  play: async ({ canvasElement }) => {
    await expectThemeMatrix(canvasElement);
  },
};
