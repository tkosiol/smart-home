import type { Meta, StoryObj } from '@storybook/angular';
import { expect, fn, userEvent } from 'storybook/test';
import { UiIconButton } from './icon-button';

const meta: Meta<UiIconButton> = {
  title: 'Bedienung/Icon-Button',
  component: UiIconButton,
  // Storybook keeps an Angular output arg only if its argType has an action; the auto-action
  // would replace the fn() spy, so it is disabled and the spy is kept.
  argTypes: { pressed: { action: 'pressed' } },
  parameters: { actions: { disable: true } },
  args: { icon: 'notifications', label: 'Benachrichtigungen', pressed: fn() },
};
export default meta;

export const Standard: StoryObj<UiIconButton> = {
  play: async ({ canvas, args }) => {
    const button = canvas.getByRole('button', { name: 'Benachrichtigungen' });
    await userEvent.tab();
    await expect(button).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await expect(args.pressed).toHaveBeenCalledTimes(1);
    await expect(button.getBoundingClientRect().width).toBeGreaterThanOrEqual(40);
  },
};
