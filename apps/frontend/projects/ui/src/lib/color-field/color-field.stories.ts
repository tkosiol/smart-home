import type { Meta, StoryObj } from '@storybook/angular';
import { expect, userEvent } from 'storybook/test';
import { UiColorField } from './color-field';

const meta: Meta<UiColorField> = {
  title: 'Bedienung/Farbfeld',
  component: UiColorField,
  args: {
    label: 'Grundfarbe',
    pickerLabel: 'Grundfarbe wählen',
    invalidMessage: 'Bitte als #rrggbb eingeben.',
    value: '#00687a',
  },
  // `value` is a model(): binding it two-way keeps what the user enters (a plain arg would be re-applied).
  render: (args) => ({
    props: { ...args },
    template: `<ui-color-field
      [label]="label"
      [pickerLabel]="pickerLabel"
      [invalidMessage]="invalidMessage"
      [hint]="hint"
      [(value)]="value"
    />`,
  }),
};
export default meta;

export const Standard: StoryObj<UiColorField> = {
  play: async ({ canvas }) => {
    const text = canvas.getByRole('textbox', { name: 'Grundfarbe' });
    const picker = canvas.getByLabelText('Grundfarbe wählen');
    const { width, height } = picker.getBoundingClientRect();
    await expect(width).toBeGreaterThanOrEqual(48);
    await expect(height).toBeGreaterThanOrEqual(48);
    await userEvent.clear(text);
    await userEvent.type(text, '8a5a00');
    await expect(picker).toHaveValue('#8a5a00');
    await userEvent.clear(text);
    await userEvent.type(text, 'zu');
    await userEvent.tab();
    await expect(canvas.getByText('Bitte als #rrggbb eingeben.')).toBeVisible();
    await expect(text).toHaveAttribute('aria-invalid', 'true');
  },
};

export const MitHinweis: StoryObj<UiColorField> = {
  args: { hint: 'Daraus entsteht das ganze Farbschema.' },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Daraus entsteht das ganze Farbschema.')).toBeVisible();
  },
};
