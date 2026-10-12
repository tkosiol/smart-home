import { provideRouter, withDisabledInitialNavigation } from '@angular/router';
import { applicationConfig, moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';
import { expect, fn, userEvent } from 'storybook/test';
import { UiBadge } from '../badge/badge';
import { UiIcon } from '../icon/icon';
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

export const Link: StoryObj<UiIconButton> = {
  decorators: [
    // Storybook's iframe path matches no route; see the button stories.
    applicationConfig({ providers: [provideRouter([], withDisabledInitialNavigation())] }),
    moduleMetadata({ imports: [UiBadge, UiIcon] }),
  ],
  render: (args) => ({
    props: args,
    template: `
      <div style="display: flex; gap: 24px; padding: 16px">
        <ui-icon-button route="/mehr" icon="notifications" label="Benachrichtigungen" />
        <ui-icon-button route="/mehr" icon="notifications" label="3 neue Benachrichtigungen">
          <ui-badge [count]="3"><ui-icon name="notifications" /></ui-badge>
        </ui-icon-button>
      </div>`,
  }),
  play: async ({ canvas, args }) => {
    const link = canvas.getByRole('link', { name: 'Benachrichtigungen' });
    // Storybook's base URL makes the router render an absolute href.
    await expect(new URL((link as HTMLAnchorElement).href).pathname).toBe('/mehr');
    await expect(canvas.queryByRole('button')).toBeNull();
    await userEvent.tab();
    await expect(link).toHaveFocus();
    await expect(args.pressed).not.toHaveBeenCalled();
    const target = link.querySelector('.mat-mdc-button-touch-target')!.getBoundingClientRect();
    await expect(target.width).toBeGreaterThanOrEqual(48);
    await expect(canvas.getByRole('link', { name: '3 neue Benachrichtigungen' })).toBeVisible();
  },
};
