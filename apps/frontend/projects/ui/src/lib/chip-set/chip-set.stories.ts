import { moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';
import { expect, userEvent, waitFor } from 'storybook/test';
import {
  expectNoHorizontalOverflow,
  touchTargetSize,
  withNarrowFrame,
} from '../testing/story-helpers';
import { expectThemeMatrix, rgb } from '../testing/theme-matrix';
import { ThemeMatrixStoryComponent, UiMatrixCell } from '../testing/theme-matrix.story-component';
import { UiChipSet, type UiChipOption } from './chip-set';

const meta: Meta<UiChipSet<string>> = {
  title: 'Bedienung/Chips',
  component: UiChipSet,
  args: {
    label: 'Räume',
    selected: [],
    options: [
      { value: 'kitchen', label: 'Küche' },
      { value: 'bath', label: 'Bad', icon: 'water_drop' },
      { value: 'office', label: 'Arbeitszimmer' },
    ],
  },
};
export default meta;

/** A theme role as the browser reports the computed colour. */
const role = (name: string): string =>
  rgb(getComputedStyle(document.documentElement).getPropertyValue(`--mat-sys-${name}`).trim());

/** Tonal chip (spec 4.2): surface-container-high, no visible border, 40 px high, pill. */
async function expectTonalChip(chip: HTMLElement): Promise<void> {
  const style = getComputedStyle(chip);
  await expect(style.backgroundColor).toBe(role('surface-container-high'));
  await expect(style.color).toBe(role('on-surface-variant'));
  await expect(style.borderTopColor).toBe('rgba(0, 0, 0, 0)');
  await expect(chip.getBoundingClientRect().height).toBe(40);
  // A finite pill radius, so the corners visibly pull in while pressed (shape morph).
  await expect(parseFloat(style.borderTopLeftRadius)).toBe(20);
  await expect(style.getPropertyValue('-webkit-tap-highlight-color')).toBe('rgba(0, 0, 0, 0)');
  await expect(touchTargetSize(chip).height).toBeGreaterThanOrEqual(48);
}

/** Selected chip: secondary-container with a check mark instead of the option's icon. */
async function expectSelectedChip(chip: HTMLElement): Promise<void> {
  await expect(chip).toHaveAttribute('aria-selected', 'true');
  // The colours transition for 150 ms after a change.
  await waitFor(async () => {
    await expect(getComputedStyle(chip).backgroundColor).toBe(role('secondary-container'));
    await expect(getComputedStyle(chip).color).toBe(role('on-secondary-container'));
  });
  await expect(chip.querySelector('ui-icon')?.textContent).toBe(String.fromCodePoint(0xe5ca));
}

// A plain value arg is re-applied by Storybook and would undo the selection; the story binding
// `[(selected)]` to a story prop keeps the selection the component writes.
export const Mehrfachauswahl: StoryObj<UiChipSet<string>> = {
  render: (args) => ({
    props: { ...args },
    template: `<ui-chip-set [label]="label" [options]="options" [(selected)]="selected" />`,
  }),
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByRole('listbox', { name: 'Räume' })).toBeVisible();
    await expect(canvasElement.querySelector('[class*="mat-"], [class*="mdc-"]')).toBeNull();
    for (const option of canvas.getAllByRole('option')) {
      await expectTonalChip(option);
    }
    // The unselected chip with an icon shows it before its label.
    await expect(
      canvas.getByRole('option', { name: 'Bad' }).querySelector('ui-icon'),
    ).not.toBeNull();
    await userEvent.tab();
    const kitchen = canvas.getByRole('option', { name: 'Küche' });
    await expect(kitchen).toHaveFocus();
    // Keyboard focus shows the solid ring of the buttons.
    await expect(getComputedStyle(kitchen).outlineStyle).toBe('solid');
    await expect(parseFloat(getComputedStyle(kitchen).outlineWidth)).toBeGreaterThan(0);
    await userEvent.keyboard(' ');
    // Arrows move the focus along the row without selecting.
    await userEvent.keyboard('{ArrowRight}');
    await expect(canvas.getByRole('option', { name: 'Bad' })).toHaveFocus();
    await expect(canvas.getByRole('option', { name: 'Bad' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
    await userEvent.keyboard(' ');
    await expectSelectedChip(kitchen);
    await expectSelectedChip(canvas.getByRole('option', { name: 'Bad' }));
    await expectTonalChip(canvas.getByRole('option', { name: 'Arbeitszimmer' }));
  },
};

export const Einzelauswahl: StoryObj<UiChipSet<string>> = {
  args: { multiple: false, selected: ['kitchen'] },
  render: (args) => ({
    props: { ...args },
    template: `<ui-chip-set [label]="label" [options]="options" [multiple]="multiple" [(selected)]="selected" />`,
  }),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('listbox')).not.toHaveAttribute('aria-multiselectable', 'true');
    await expectSelectedChip(canvas.getByRole('option', { name: 'Küche' }));
    // Tab lands on the selected chip, not on the first one.
    await userEvent.tab();
    await expect(canvas.getByRole('option', { name: 'Küche' })).toHaveFocus();
    await userEvent.click(canvas.getByRole('option', { name: 'Arbeitszimmer' }));
    await expectSelectedChip(canvas.getByRole('option', { name: 'Arbeitszimmer' }));
    await expect(canvas.getByRole('option', { name: 'Küche' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
    await waitFor(() => expectTonalChip(canvas.getByRole('option', { name: 'Küche' })));
  },
};

export const Deaktiviert: StoryObj<UiChipSet<string>> = {
  args: { disabled: true, selected: ['bath'] },
  render: (args) => ({
    props: { ...args },
    template: `<ui-chip-set [label]="label" [options]="options" [disabled]="disabled" [(selected)]="selected" />`,
  }),
  play: async ({ canvas }) => {
    for (const option of canvas.getAllByRole('option')) {
      await expect(option).toBeDisabled();
    }
    await userEvent.click(canvas.getByRole('option', { name: 'Küche' }), { pointerEventsCheck: 0 });
    await expect(canvas.getByRole('option', { name: 'Küche' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
    await expect(canvas.getByRole('option', { name: 'Bad' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  },
};

/** The readings of a device (spec 4.3): more chips than a phone is wide. */
const READINGS: readonly UiChipOption<string>[] = [
  { value: 'soil', label: 'Bodenfeuchte' },
  { value: 'temperature', label: 'Temperatur' },
  { value: 'humidity', label: 'Luftfeuchte' },
  { value: 'battery', label: 'Batterie' },
  { value: 'illuminance', label: 'Lichtstärke' },
];

// On the narrowest phone the row scrolls sideways (hidden scrollbar, faded edge, snapping)
// instead of wrapping or making the page scroll sideways; every chip stays on one line.
export const Schmal: StoryObj<UiChipSet<string>> = {
  decorators: [withNarrowFrame],
  args: { label: 'Messwert', multiple: false, options: READINGS, selected: ['soil'] },
  render: (args) => ({
    props: { ...args },
    template: `<ui-chip-set [label]="label" [options]="options" [multiple]="multiple" [(selected)]="selected" />`,
  }),
  play: async ({ canvas, canvasElement }) => {
    const frame = canvasElement.querySelector<HTMLElement>('.story-narrow')!;
    await expectNoHorizontalOverflow(frame);
    const row = canvas.getByRole('listbox', { name: 'Messwert' });
    await expect(row.scrollWidth).toBeGreaterThan(row.clientWidth);
    await expect(getComputedStyle(row).overflowX).toBe('auto');
    await expect(getComputedStyle(row).scrollSnapType).toContain('x');
    for (const option of canvas.getAllByRole('option')) {
      await expect(option.getBoundingClientRect().height).toBe(40);
      await expect(touchTargetSize(option).height).toBeGreaterThanOrEqual(48);
    }
    // Only the far edge fades while the row is at its start, the near one at its end.
    const host = canvasElement.querySelector('ui-chip-set')!;
    await waitFor(() => expect(host).toHaveAttribute('data-fade', 'right'));
    await userEvent.tab();
    await userEvent.keyboard('{End}');
    await expect(canvas.getByRole('option', { name: 'Lichtstärke' })).toHaveFocus();
    await waitFor(() => expect(row.scrollLeft).toBeGreaterThan(0));
    await waitFor(() => expect(host).toHaveAttribute('data-fade', 'left'));
    await userEvent.keyboard(' ');
    await expectSelectedChip(canvas.getByRole('option', { name: 'Lichtstärke' }));
    await expectNoHorizontalOverflow(frame);
  },
};

/** The severity filter of "Alle Hinweise" (spec 3.4): counts from the entries, several selectable. */
const severities: readonly UiChipOption<string>[] = [
  { value: 'all', label: 'Alle', count: 20, icon: 'check' },
  { value: 'critical', label: 'Kritisch', count: 2 },
  { value: 'warning', label: 'Warnung', count: 13 },
  { value: 'info', label: 'Hinweis', count: 5 },
];

export const MitZaehlern: StoryObj<UiChipSet<string>> = {
  args: { label: 'Nach Dringlichkeit filtern', options: severities, selected: ['all'] },
  render: (args) => ({
    props: { ...args },
    template: `<ui-chip-set [label]="label" [options]="options" [(selected)]="selected" />`,
  }),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('listbox', { name: 'Nach Dringlichkeit filtern' })).toBeVisible();
    const all = canvas.getByRole('option', { name: 'Alle 20' });
    await expectSelectedChip(all);
    await expectTonalChip(canvas.getByRole('option', { name: 'Kritisch 2' }));
    await userEvent.click(canvas.getByRole('option', { name: 'Kritisch 2' }));
    await expectSelectedChip(canvas.getByRole('option', { name: 'Kritisch 2' }));
    await expect(canvas.getByRole('option', { name: 'Alle 20' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  },
};

export const Kombinationen: StoryObj<UiChipSet<string>> = {
  decorators: [moduleMetadata({ imports: [ThemeMatrixStoryComponent, UiMatrixCell] })],
  args: { label: 'Nach Dringlichkeit filtern', options: severities, selected: ['all', 'critical'] },
  render: (args) => ({
    props: { ...args },
    template: `
      <ui-theme-matrix>
        <ng-template uiMatrixCell>
          <ui-chip-set [label]="label" [options]="options" [selected]="selected" />
        </ng-template>
      </ui-theme-matrix>`,
  }),
  play: async ({ canvasElement }) => {
    await expectThemeMatrix(canvasElement);
  },
};
