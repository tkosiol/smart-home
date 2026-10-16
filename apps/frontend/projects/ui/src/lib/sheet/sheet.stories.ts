import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { applicationConfig, moduleMetadata, type Meta, type StoryObj } from '@storybook/angular';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { UiButton } from '../button/button';
import { UiStatusEntry } from '../status-hero/status-entry';
import { UiSwitch } from '../switch/switch';
import { expectNoHorizontalOverflow, withPhoneFrame } from '../testing/story-helpers';
import { expectThemeMatrix, rgb } from '../testing/theme-matrix';
import { ThemeMatrixStoryComponent, UiMatrixCell } from '../testing/theme-matrix.story-component';
import { UiSheet, UiSheetActions } from './sheet';
import { SheetStoryOpener } from './sheet.story-component';

const meta: Meta<UiSheet> = {
  title: 'Rahmen/Sheet',
  component: UiSheet,
  decorators: [
    applicationConfig({
      providers: [{ provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } }],
    }),
    moduleMetadata({ imports: [UiSheetActions, UiButton, UiStatusEntry, UiSwitch] }),
  ],
};
export default meta;

/** The frame on its own, as it sits in the bottom sheet (handle, heading, rows, actions). */
const frame = `
  <div style="border-radius: var(--smart-shape-card); background: var(--mat-sys-surface-container-low)">
    <ui-sheet heading="Übersicht anpassen" description="Blöcke ein- oder ausblenden und mit dem Ziehgriff sortieren.">
      <ui-status-entry icon="info" kindTone="primary-container" title="Status" subtitle="Was gerade Aufmerksamkeit braucht">
        <ui-switch label="Status anzeigen" [checked]="true" />
      </ui-status-entry>
      <ui-status-entry icon="devices" kindTone="surface" title="Geräte" subtitle="Alle Geräte als Pods">
        <ui-switch label="Geräte anzeigen" />
      </ui-status-entry>
      <div uiSheetActions>
        <ui-button variant="text">Zurücksetzen</ui-button>
        <ui-button>Fertig</ui-button>
      </div>
    </ui-sheet>
  </div>`;

export const Inhalt: StoryObj<UiSheet> = {
  render: () => ({ template: `<div style="max-width: 420px">${frame}</div>` }),
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByRole('heading', { level: 2 })).toHaveTextContent('Übersicht anpassen');
    await expect(canvasElement.querySelector('.handle')).not.toBeNull();
    await expect(canvas.getAllByRole('switch')).toHaveLength(2);
    const buttons = canvas.getAllByRole('button');
    await expect(buttons.map((button) => button.textContent?.trim())).toEqual([
      'Zurücksetzen',
      'Fertig',
    ]);
  },
};

export const Schmal: StoryObj<UiSheet> = {
  decorators: [withPhoneFrame],
  render: () => ({ template: frame }),
  play: async ({ canvasElement }) => {
    await expectNoHorizontalOverflow(canvasElement.querySelector('.story-narrow')!);
  },
};

/**
 * The service: a bottom sheet on compact windows, a dialog from medium up, in a native `<dialog>`
 * loaded lazily. The dialog sits in the top layer outside the story root, so it is checked here,
 * not by axe.
 */
export const Oeffnen: StoryObj<UiSheet> = {
  decorators: [moduleMetadata({ imports: [SheetStoryOpener] })],
  render: () => ({ template: '<ui-sheet-story-opener />' }),
  play: async ({ canvas }) => {
    const dialog = () => document.querySelector<HTMLDialogElement>('ui-sheet-host dialog[open]');
    await userEvent.click(canvas.getByRole('button', { name: /Übersicht anpassen/ }));
    await waitFor(() => expect(dialog()).not.toBeNull());
    const opened = dialog()!;
    const expected = window.innerWidth >= 600 ? 'dialog' : 'sheet';
    await expect(opened.getAttribute('data-presentation')).toBe(expected);
    await expect(opened.matches(':modal')).toBe(true);
    await waitFor(() =>
      expect(opened.getAttribute('aria-labelledby')).toBe(opened.querySelector('h2')?.id),
    );
    await expect(within(opened).getByRole('heading', { level: 2 })).toHaveTextContent(
      'Übersicht anpassen',
    );
    // The surface is surface-container-low with the card shape (spec 2.2).
    const root = getComputedStyle(document.documentElement);
    const surface = opened.querySelector<HTMLElement>('.surface')!;
    await expect(getComputedStyle(surface).backgroundColor).toBe(
      rgb(root.getPropertyValue('--mat-sys-surface-container-low').trim()),
    );
    await expect(getComputedStyle(surface).borderTopLeftRadius).toBe(
      root.getPropertyValue('--mat-sys-corner-extra-large').trim(),
    );
    // Focus starts inside; Escape closes and resolves undefined ("verworfen").
    await waitFor(() => expect(opened.contains(document.activeElement)).toBe(true));
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(dialog()).toBeNull());
    await waitFor(() => expect(canvas.getByText('verworfen')).toBeVisible());
    // "Fertig" resolves with the content's result; focus returns to the opener.
    const opener = canvas.getByRole('button', { name: /Übersicht anpassen/ });
    await userEvent.click(opener);
    await waitFor(() => expect(dialog()).not.toBeNull());
    await userEvent.click(within(dialog()!).getByRole('button', { name: 'Fertig' }));
    await waitFor(() => expect(dialog()).toBeNull());
    await waitFor(() => expect(canvas.getByText('saved')).toBeVisible());
    await expect(opener).toHaveFocus();
  },
};

export const Kombinationen: StoryObj<UiSheet> = {
  decorators: [moduleMetadata({ imports: [ThemeMatrixStoryComponent, UiMatrixCell] })],
  render: () => ({
    template: `<ui-theme-matrix><ng-template uiMatrixCell>${frame}</ng-template></ui-theme-matrix>`,
  }),
  play: async ({ canvasElement }) => {
    await expectThemeMatrix(canvasElement);
  },
};
