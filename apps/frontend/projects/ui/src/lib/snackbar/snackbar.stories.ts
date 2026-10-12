import { Component, inject, signal } from '@angular/core';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';
import { expect, screen, userEvent, waitFor } from 'storybook/test';
import { UiButton } from '../button/button';
import { waitForTranslations } from '../testing/storybook-environment';
import { UiSnackbar } from './snackbar';

@Component({
  selector: 'ui-snackbar-demo',
  imports: [UiButton],
  template: ` <ui-button (pressed)="show()">Raum löschen</ui-button>
    <p>Ergebnis: {{ result() }}</p>`,
})
class SnackbarDemo {
  private readonly snackbar = inject(UiSnackbar);
  protected readonly result = signal('–');
  protected async show(): Promise<void> {
    this.result.set(await this.snackbar.show('Raum gelöscht', { action: 'Rückgängig' }));
  }
}

// Material's snack bar starts at opacity 0 and fades in after its enter animation. Disabling
// Material's animations shows it at once, so the play function's visibility check need not wait.
const meta: Meta<SnackbarDemo> = {
  title: 'Rückmeldung/Snackbar',
  component: SnackbarDemo,
  decorators: [
    applicationConfig({
      providers: [{ provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } }],
    }),
  ],
};
export default meta;

export const MitAktion: StoryObj<SnackbarDemo> = {
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Raum löschen' }));
    await expect(await screen.findByText('Raum gelöscht')).toBeVisible();
    // Material keeps the action hidden from assistive tech for about 150 ms before announcing it.
    await userEvent.click(await screen.findByRole('button', { name: 'Rückgängig' }));
    await waitFor(() => expect(canvas.getByText('Ergebnis: action')).toBeVisible());
  },
};

// A message with an action stays until it is closed; the keyboard reaches the close button.
// The second test-runner pass repeats this in English, hence both names.
export const Schliessen: StoryObj<SnackbarDemo> = {
  play: async ({ canvas }) => {
    await waitForTranslations();
    await userEvent.click(canvas.getByRole('button', { name: 'Raum löschen' }));
    const close = await screen.findByRole('button', { name: /^(Schließen|Close)$/ });
    for (let presses = 0; presses < 4 && document.activeElement !== close; presses++) {
      await userEvent.tab();
    }
    await expect(close).toHaveFocus();
    // Readable on the inverse surface, not Material's default on-surface-variant.
    const surface = close.closest('.mat-mdc-snackbar-surface')!;
    await expect(getComputedStyle(close).color).toBe(getComputedStyle(surface).color);
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(canvas.getByText('Ergebnis: dismissed')).toBeVisible());
  },
};
