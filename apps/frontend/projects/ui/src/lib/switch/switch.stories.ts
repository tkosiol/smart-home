import type { Meta, StoryObj } from '@storybook/angular';
import { expect, userEvent } from 'storybook/test';
import { UiSwitch } from './switch';

const meta: Meta<UiSwitch> = {
  title: 'Bedienung/Switch',
  component: UiSwitch,
  args: { label: 'Benachrichtigungen erlauben' },
};
export default meta;

export const Standard: StoryObj<UiSwitch> = {
  play: async ({ canvas }) => {
    const control = canvas.getByRole('switch', { name: 'Benachrichtigungen erlauben' });
    await userEvent.tab();
    await expect(control).toHaveFocus();
    await userEvent.keyboard(' ');
    await expect(control).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(canvas.getByText('Benachrichtigungen erlauben'));
    await expect(control).toHaveAttribute('aria-checked', 'false');
  },
};

export const Deaktiviert: StoryObj<UiSwitch> = {
  args: { disabled: true, checked: true },
  play: async ({ canvas }) => {
    const control = canvas.getByRole('switch');
    await userEvent.click(control, { pointerEventsCheck: 0 });
    await expect(control).toHaveAttribute('aria-checked', 'true');
  },
};
