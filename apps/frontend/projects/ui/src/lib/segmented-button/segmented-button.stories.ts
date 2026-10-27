import type { Meta, StoryObj } from '@storybook/angular';
import { expect, userEvent, waitFor } from 'storybook/test';
import type { UiOption } from '../option';
import {
  expectNoHorizontalOverflow,
  touchTargetSize,
  withNarrowFrame,
} from '../testing/story-helpers';
import { rgb } from '../testing/theme-matrix';
import { UiSegmentedButton } from './segmented-button';

const meta: Meta<UiSegmentedButton<string>> = {
  title: 'Bedienung/Segmented Button',
  component: UiSegmentedButton,
  args: {
    label: 'Modus',
    value: 'system',
    options: [
      { value: 'system', label: 'System' },
      { value: 'light', label: 'Hell', icon: 'light_mode' },
      { value: 'dark', label: 'Dunkel', icon: 'dark_mode' },
    ],
  },
};
export default meta;

/** A theme role as the browser reports the computed colour. */
const role = (name: string): string =>
  rgb(getComputedStyle(document.documentElement).getPropertyValue(`--mat-sys-${name}`).trim());

/** The four corner radii of a segment, clockwise from the top left. */
const corners = (segment: Element): number[] => {
  const style = getComputedStyle(segment);
  return [
    style.borderTopLeftRadius,
    style.borderTopRightRadius,
    style.borderBottomRightRadius,
    style.borderBottomLeftRadius,
  ].map(parseFloat);
};

/** The selected segment is a quiet pill (spec 4.2): secondary-container, all corners full. */
async function expectSelected(segment: HTMLElement): Promise<void> {
  await expect(segment).toBeChecked();
  // The colours and corners transition for 150 ms after a change.
  await waitFor(async () => {
    await expect(getComputedStyle(segment).backgroundColor).toBe(role('secondary-container'));
    await expect(getComputedStyle(segment).color).toBe(role('on-secondary-container'));
    await expect(corners(segment)).toEqual([20, 20, 20, 20]);
  });
}

// A plain value arg is re-applied by Storybook and would undo the selection; the story binding
// `[(value)]` to a story prop keeps the selection the component writes.
export const Standard: StoryObj<UiSegmentedButton<string>> = {
  render: (args) => ({
    props: { ...args },
    template: `<ui-segmented-button [label]="label" [options]="options" [(value)]="value" />`,
  }),
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByRole('radiogroup', { name: 'Modus' })).toBeVisible();
    await expect(canvasElement.querySelector('[class*="mat-"], [class*="mdc-"]')).toBeNull();
    const radios = canvas.getAllByRole('radio');
    for (const radio of radios) {
      // 40 px high like the buttons, with the 48 px touch target; no grey tap rectangle.
      await expect(radio.getBoundingClientRect().height).toBe(40);
      await expect(touchTargetSize(radio).height).toBeGreaterThanOrEqual(48);
      await expect(getComputedStyle(radio).getPropertyValue('-webkit-tap-highlight-color')).toBe(
        'rgba(0, 0, 0, 0)',
      );
    }
    // A connected button group (M3 Expressive): 2 px apart, no divider lines, no outline.
    for (let index = 1; index < radios.length; index++) {
      const previous = radios[index - 1]!.getBoundingClientRect();
      await expect(radios[index]!.getBoundingClientRect().left - previous.right).toBeCloseTo(2);
    }
    const [system, light, dark] = radios as [HTMLElement, HTMLElement, HTMLElement];
    await expectSelected(system);
    // Unselected segments are tonal; the outer ends are full, the inner corners small.
    for (const segment of [light, dark]) {
      await expect(getComputedStyle(segment).backgroundColor).toBe(role('surface-container-high'));
      await expect(getComputedStyle(segment).color).toBe(role('on-surface'));
      await expect(getComputedStyle(segment).borderTopColor).toBe('rgba(0, 0, 0, 0)');
    }
    await expect(corners(light)).toEqual([8, 8, 8, 8]);
    await expect(corners(dark)).toEqual([8, 20, 20, 8]);
    await userEvent.tab();
    await expect(system).toHaveFocus();
    // Keyboard focus shows the solid ring of the buttons.
    await expect(getComputedStyle(system).outlineStyle).toBe('solid');
    await expect(parseFloat(getComputedStyle(system).outlineWidth)).toBeGreaterThan(0);
    // Arrow keys move the choice (radio group pattern); the first segment keeps its full outer end.
    await userEvent.keyboard('{ArrowRight}');
    await expectSelected(light);
    await expect(light).toHaveFocus();
    await waitFor(async () => {
      await expect(corners(system)).toEqual([20, 8, 8, 20]);
    });
    await userEvent.click(dark);
    await expectSelected(dark);
    await expect(light).not.toBeChecked();
    // Only the chosen segment is in the tab order.
    await expect(dark).toHaveAttribute('tabindex', '0');
    await expect(system).toHaveAttribute('tabindex', '-1');
  },
};

export const Deaktiviert: StoryObj<UiSegmentedButton<string>> = {
  args: { disabled: true },
  render: (args) => ({
    props: { ...args },
    template: `<ui-segmented-button [label]="label" [options]="options" [disabled]="disabled" [(value)]="value" />`,
  }),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('radio', { name: 'Dunkel' })).toBeDisabled();
    await userEvent.click(canvas.getByRole('radio', { name: 'Dunkel' }), { pointerEventsCheck: 0 });
    await expect(canvas.getByRole('radio', { name: 'System' })).toBeChecked();
    await expect(canvas.getByRole('radio', { name: 'Dunkel' })).not.toBeChecked();
  },
};

const CONTRAST_OPTIONS: readonly UiOption<string>[] = [
  { value: 'system', label: 'System' },
  { value: 'standard', label: 'Standard' },
  { value: 'medium', label: 'Mittel' },
  { value: 'high', label: 'Hoch' },
];

const FONT_OPTIONS: readonly UiOption<string>[] = [
  { value: 'roboto-flex', label: 'Roboto Flex' },
  { value: 'figtree', label: 'Figtree' },
  { value: 'atkinson', label: 'Atkinson Hyperlegible' },
];

/** The range of a history (spec 4.3). */
const RANGE_OPTIONS: readonly UiOption<string>[] = [
  { value: 'day', label: '24 h' },
  { value: 'week', label: '7 Tage' },
  { value: 'month', label: '4 Wochen' },
];

// The theme editor's pickers on the narrowest phone: long labels wrap inside their segment
// instead of pushing the group wider than the screen.
export const Schmal: StoryObj<UiSegmentedButton<string>> = {
  decorators: [withNarrowFrame],
  render: () => ({
    props: {
      contrastOptions: CONTRAST_OPTIONS,
      fontOptions: FONT_OPTIONS,
      rangeOptions: RANGE_OPTIONS,
      contrast: 'system',
      font: 'atkinson',
      range: 'week',
    },
    template: `
      <div style="display: grid; gap: 16px">
        <ui-segmented-button label="Kontrast" [options]="contrastOptions" [(value)]="contrast" />
        <ui-segmented-button label="Schrift" [options]="fontOptions" [(value)]="font" />
        <ui-segmented-button label="Zeitraum" [options]="rangeOptions" [(value)]="range" />
      </div>
    `,
  }),
  play: async ({ canvas, canvasElement }) => {
    await expectNoHorizontalOverflow(canvasElement.querySelector('.story-narrow')!);
    for (const radio of canvas.getAllByRole('radio')) {
      await expect(radio.getBoundingClientRect().height).toBeGreaterThanOrEqual(40);
      await expect(touchTargetSize(radio).height).toBeGreaterThanOrEqual(48);
      await expect(touchTargetSize(radio).width).toBeGreaterThanOrEqual(48);
    }
    await userEvent.click(canvas.getByRole('radio', { name: 'Hoch' }));
    await expect(canvas.getByRole('radio', { name: 'Hoch' })).toBeChecked();
    await userEvent.click(canvas.getByRole('radio', { name: 'Figtree' }));
    await expect(canvas.getByRole('radio', { name: 'Figtree' })).toBeChecked();
    await expectSelected(canvas.getByRole('radio', { name: '7 Tage' }));
  },
};

/** `fullWidth`: the group fills its container and the segments share the width evenly. */
export const VolleBreite: StoryObj<UiSegmentedButton<string>> = {
  args: { fullWidth: true },
  render: (args) => ({
    props: args,
    template: `<div data-testid="frame" style="width: 480px"><ui-segmented-button [label]="label" [options]="options" [value]="value" fullWidth /></div>`,
  }),
  play: async ({ canvas }) => {
    const frame = canvas.getByTestId('frame').getBoundingClientRect();
    const group = canvas.getByRole('radiogroup').getBoundingClientRect();
    await expect(Math.round(group.width)).toBe(Math.round(frame.width));
  },
};
