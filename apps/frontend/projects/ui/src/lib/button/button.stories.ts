import { provideRouter, withDisabledInitialNavigation } from '@angular/router';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';
import { expect, fn, userEvent } from 'storybook/test';
import { touchTargetSize } from '../testing/story-helpers';
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
      </div>
      <div style="width: 320px; margin-top: 12px">
        <ui-button fullWidth>Volle Breite</ui-button>
      </div>`,
  }),
  play: async ({ canvas, args }) => {
    // Full width: the button is as wide as its container.
    await expect(
      canvas.getByRole('button', { name: 'Volle Breite' }).getBoundingClientRect().width,
    ).toBe(320);
    const filled = canvas.getByRole('button', { name: 'Gefüllt' });
    await userEvent.tab();
    await expect(filled).toHaveFocus();
    // Keyboard focus shows a solid ring, not only the faint state layer.
    const focused = getComputedStyle(filled);
    await expect(focused.outlineStyle).toBe('solid');
    await expect(parseFloat(focused.outlineWidth)).toBeGreaterThan(0);
    // The touch target reaches 48 px although the button is 40 px high.
    await expect(touchTargetSize(filled).height).toBeGreaterThanOrEqual(48);
    await expect(filled.getBoundingClientRect().height).toBe(40);
    // No grey tap rectangle on phones over the state layer.
    await expect(focused.getPropertyValue('-webkit-tap-highlight-color')).toBe('rgba(0, 0, 0, 0)');
    // A finite resting radius, so the corners visibly pull in while pressed (shape morph).
    await expect(parseFloat(focused.borderTopLeftRadius)).toBeLessThanOrEqual(20);
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

export const Link: Story = {
  decorators: [
    // Storybook's iframe path matches no route; see the list stories.
    applicationConfig({ providers: [provideRouter([], withDisabledInitialNavigation())] }),
  ],
  render: (args) => ({
    props: args,
    template: `
      <div style="display: flex; flex-wrap: wrap; gap: 12px">
        <ui-button route="/raeume" icon="add" (pressed)="pressed()">Räume</ui-button>
        <ui-button route="/raeume" variant="outlined">Umrandet</ui-button>
      </div>`,
  }),
  play: async ({ canvas, args }) => {
    const link = canvas.getByRole('link', { name: 'Räume' });
    // Storybook's base URL makes the router render an absolute href.
    await expect(new URL((link as HTMLAnchorElement).href).pathname).toBe('/raeume');
    await expect(link.querySelector('ui-icon')).not.toBeNull();
    await expect(canvas.queryByRole('button')).toBeNull();
    await userEvent.tab();
    await expect(link).toHaveFocus();
    await expect(args.pressed).not.toHaveBeenCalled();
    await expect(link.getBoundingClientRect().height).toBeGreaterThanOrEqual(40);
  },
};
