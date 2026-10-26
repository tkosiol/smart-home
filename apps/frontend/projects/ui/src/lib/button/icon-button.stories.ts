import { provideRouter, withDisabledInitialNavigation } from '@angular/router';
import { applicationConfig, moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';
import { expect, fn, userEvent } from 'storybook/test';
import { UiBadge } from '../badge/badge';
import { UiIcon } from '../icon/icon';
import { expectThemeMatrix, rgb } from '../testing/theme-matrix';
import { ThemeMatrixStoryComponent, UiMatrixCell } from '../testing/theme-matrix.story-component';
import { touchTargetSize } from '../testing/story-helpers';
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
    const target = touchTargetSize(link);
    await expect(target.width).toBeGreaterThanOrEqual(48);
    await expect(target.height).toBeGreaterThanOrEqual(48);
    await expect(canvas.getByRole('link', { name: '3 neue Benachrichtigungen' })).toBeVisible();
  },
};

/** The tonal buttons of the top app bar and the device page (spec 3.1, 3.3). */
const tonalRow = `
  <div style="display: flex; gap: 8px; align-items: center">
    <ui-icon-button variant="tonal" icon="arrow_back" label="Zurück" />
    <ui-icon-button variant="tonal" icon="settings" label="Übersicht anpassen" />
    <ui-icon-button variant="tonal" icon="more_horiz" label="Weitere Optionen" disabled />
    <ui-icon-button variant="tonal" route="/mehr" icon="notifications" label="Benachrichtigungen" />
  </div>`;

export const Tonal: StoryObj<UiIconButton> = {
  decorators: [
    applicationConfig({ providers: [provideRouter([], withDisabledInitialNavigation())] }),
  ],
  render: () => ({ template: tonalRow }),
  play: async ({ canvas }) => {
    const button = canvas.getByRole('button', { name: 'Übersicht anpassen' });
    const style = getComputedStyle(button);
    await expect(style.getPropertyValue('-webkit-tap-highlight-color')).toBe('rgba(0, 0, 0, 0)');
    const root = getComputedStyle(document.documentElement);
    await expect(getComputedStyle(button).backgroundColor).toBe(
      rgb(root.getPropertyValue('--mat-sys-surface-container-high').trim()),
    );
    // A full circle: the radius is half the width.
    await expect(parseFloat(getComputedStyle(button).borderTopLeftRadius)).toBe(
      button.getBoundingClientRect().width / 2,
    );
    await expect(getComputedStyle(button.querySelector('ui-icon')!).color).toBe(
      rgb(root.getPropertyValue('--mat-sys-on-surface-variant').trim()),
    );
    // The tonal disc itself is the 48 px touch target.
    await expect(button.getBoundingClientRect().width).toBe(48);
    await expect(button.getBoundingClientRect().height).toBe(48);
    await expect(canvas.getByRole('button', { name: 'Weitere Optionen' })).toBeDisabled();
    await expect(canvas.getByRole('link', { name: 'Benachrichtigungen' })).toBeVisible();
    await userEvent.tab();
    await expect(canvas.getByRole('button', { name: 'Zurück' })).toHaveFocus();
  },
};

export const Kombinationen: StoryObj<UiIconButton> = {
  decorators: [
    applicationConfig({ providers: [provideRouter([], withDisabledInitialNavigation())] }),
    moduleMetadata({ imports: [ThemeMatrixStoryComponent, UiMatrixCell] }),
  ],
  render: () => ({
    template: `
      <ui-theme-matrix>
        <ng-template uiMatrixCell>
          ${tonalRow}
          <div style="display: flex; gap: 8px; align-items: center">
            <ui-icon-button icon="settings" label="Einstellungen" />
            <ui-icon-button icon="close" label="Schließen" disabled />
          </div>
        </ng-template>
      </ui-theme-matrix>`,
  }),
  play: async ({ canvasElement }) => {
    await expectThemeMatrix(canvasElement);
  },
};
