import { Component, inject, signal } from '@angular/core';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { applicationConfig, type Meta, type StoryObj } from '@storybook/angular';
import { expect, screen, userEvent, waitFor } from 'storybook/test';
import { UiButton } from '../button/button';
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
