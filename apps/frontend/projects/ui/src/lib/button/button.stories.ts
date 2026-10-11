import type { Meta, StoryObj } from '@storybook/angular';
import { expect, fn, userEvent } from 'storybook/test';
import { UiButton } from './button';

const meta: Meta<UiButton> = {
  title: 'Bedienung/Button',
  component: UiButton,
  // Storybook keeps an Angular output arg only if its argType has an action; the auto-action
  // would replace the fn() spy, so it is disabled and the spy is kept.
  argTypes: { pressed: { action: 'pressed' } },
  parameters: { actions: { disable: true } },
  args: { pressed: fn() },
};
export default meta;
type Story = StoryObj<UiButton>;

export const Varianten: Story = {
  render: (args) => ({
    props: args,
    template: `
      <div style="display: flex; flex-wrap: wrap; gap: 12px">
        <ui-button (pressed)="pressed()">Gefüllt</ui-button>
        <ui-button variant="tonal" icon="add">Tonal mit Icon</ui-button>
        <ui-button variant="outlined">Umrandet</ui-button>
        <ui-button variant="text">Text</ui-button>
        <ui-button variant="elevated">Erhöht</ui-button>
        <ui-button disabled>Deaktiviert</ui-button>
      </div>`,
  }),
  play: async ({ canvas, args }) => {
    const filled = canvas.getByRole('button', { name: 'Gefüllt' });
    await userEvent.tab();
    await expect(filled).toHaveFocus();
    // Keyboard focus must show Material's strong focus ring, not only the faint state layer.
    const ring = getComputedStyle(filled.querySelector('.mat-focus-indicator')!, '::before');
    await expect(ring.display).not.toBe('none');
    await expect(ring.borderTopStyle).not.toBe('none');
    await expect(parseFloat(ring.borderTopWidth)).toBeGreaterThan(0);
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard(' ');
    await expect(args.pressed).toHaveBeenCalledTimes(2);
    await expect(canvas.getByRole('button', { name: 'Deaktiviert' })).toBeDisabled();
    await expect(filled.getBoundingClientRect().height).toBeGreaterThanOrEqual(40);
  },
};

export const DeaktiviertLoestNichtsAus: Story = {
  args: { disabled: true },
  render: (args) => ({
    props: args,
    template: `<ui-button [disabled]="disabled" (pressed)="pressed()">Speichern</ui-button>`,
  }),
  play: async ({ canvas, args }) => {
    const button = canvas.getByRole('button', { name: 'Speichern' });
    await userEvent.click(button, { pointerEventsCheck: 0 });
    await userEvent.tab();
    await userEvent.keyboard('{Enter}');
    await expect(args.pressed).not.toHaveBeenCalled();
  },
};
