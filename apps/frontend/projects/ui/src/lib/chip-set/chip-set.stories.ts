import { moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';
import { expect, fireEvent, userEvent } from 'storybook/test';
import { expectNoHorizontalOverflow, withNarrowFrame } from '../testing/story-helpers';
import { expectThemeMatrix } from '../testing/theme-matrix';
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

// A plain value arg is re-applied by Storybook and would undo the selection; the story binding
// `[(selected)]` to a story prop keeps the selection the component writes.
export const Mehrfachauswahl: StoryObj<UiChipSet<string>> = {
  render: (args) => ({
    props: { ...args },
    template: `<ui-chip-set [label]="label" [options]="options" [(selected)]="selected" />`,
  }),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('listbox', { name: 'Räume' })).toBeVisible();
    for (const option of canvas.getAllByRole('option')) {
      await expect(option.getBoundingClientRect().height).toBeGreaterThanOrEqual(48);
    }
    await userEvent.tab();
    await expect(canvas.getByRole('option', { name: 'Küche' })).toHaveFocus();
    await userEvent.keyboard(' ');
    // user-event sends no keyCode, and Material's listbox reads keyCode for the arrow keys.
    await fireEvent.keyDown(canvas.getByRole('option', { name: 'Küche' }), {
      key: 'ArrowRight',
      code: 'ArrowRight',
      keyCode: 39,
    });
    await userEvent.keyboard(' ');
    await expect(canvas.getByRole('option', { name: 'Küche' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(canvas.getByRole('option', { name: 'Bad' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  },
};

export const Einzelauswahl: StoryObj<UiChipSet<string>> = {
  args: { multiple: false, selected: ['kitchen'] },
  render: (args) => ({
    props: { ...args },
    template: `<ui-chip-set [label]="label" [options]="options" [multiple]="multiple" [(selected)]="selected" />`,
  }),
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('option', { name: 'Arbeitszimmer' }));
    await expect(canvas.getByRole('option', { name: 'Arbeitszimmer' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(canvas.getByRole('option', { name: 'Küche' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
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
      await expect(option).toHaveAttribute('aria-disabled', 'true');
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

// A long German label on the narrowest phone must not make the page scroll sideways.
export const Schmal: StoryObj<UiChipSet<string>> = {
  decorators: [withNarrowFrame],
  args: {
    options: [
      { value: 'kitchen', label: 'Küche' },
      { value: 'heating', label: 'Heizungsthermostatsteuerung im Wohnzimmer', icon: 'sensors' },
      { value: 'captain', label: 'Donaudampfschifffahrtsgesellschaftskapitän' },
    ],
  },
  render: (args) => ({
    props: { ...args },
    template: `<ui-chip-set [label]="label" [options]="options" [(selected)]="selected" />`,
  }),
  play: async ({ canvas, canvasElement }) => {
    await expectNoHorizontalOverflow(canvasElement.querySelector('.story-narrow')!);
    for (const option of canvas.getAllByRole('option')) {
      await expect(option.getBoundingClientRect().height).toBeGreaterThanOrEqual(48);
    }
    await userEvent.click(
      canvas.getByRole('option', { name: 'Donaudampfschifffahrtsgesellschaftskapitän' }),
    );
    await expect(
      canvas.getByRole('option', { name: 'Donaudampfschifffahrtsgesellschaftskapitän' }),
    ).toHaveAttribute('aria-selected', 'true');
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
    await expect(all).toHaveAttribute('aria-selected', 'true');
    // The pill shape (spec 2.1) sits on the chip, the option button is its inner action.
    await expect(getComputedStyle(all.closest('mat-chip-option')!).borderRadius).toBe('9999px');
    await expect(all.getBoundingClientRect().height).toBeGreaterThanOrEqual(48);
    await userEvent.click(canvas.getByRole('option', { name: 'Kritisch 2' }));
    await expect(canvas.getByRole('option', { name: 'Kritisch 2' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
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
