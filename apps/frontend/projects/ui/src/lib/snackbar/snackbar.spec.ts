import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { provideUiTranslocoTesting } from '../testing/i18n-testing';
import { UiSnackbar } from './snackbar';

function setup(language: 'de' | 'en' = 'de') {
  TestBed.configureTestingModule({
    providers: [
      provideUiTranslocoTesting(language),
      { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
    ],
  });
  return { snackbar: TestBed.inject(UiSnackbar), material: TestBed.inject(MatSnackBar) };
}

async function settle(): Promise<void> {
  TestBed.tick();
  await new Promise((resolve) => setTimeout(resolve));
  TestBed.tick();
}

const buttons = () => [
  ...document.querySelectorAll<HTMLButtonElement>('mat-snack-bar-container button'),
];
const buttonNamed = (name: string) =>
  buttons().find(
    (button) => (button.getAttribute('aria-label') ?? button.textContent)?.trim() === name,
  );

describe('UiSnackbar', () => {
  it('closes plain messages after four seconds, politely', () => {
    const { snackbar, material } = setup();
    const open = vi.spyOn(material, 'openFromComponent');
    void snackbar.show('Gespeichert');
    expect(open.mock.calls[0]![1]).toMatchObject({ duration: 4000, politeness: 'polite' });
  });

  it('sets the panel class that keeps it clear of the compact bottom bar', () => {
    const { snackbar, material } = setup();
    const open = vi.spyOn(material, 'openFromComponent');
    void snackbar.show('Gespeichert');
    expect(open.mock.calls[0]![1]!.panelClass).toBe('ui-snackbar');
  });

  it('keeps messages with an action open and can be assertive', () => {
    const { snackbar, material } = setup();
    const open = vi.spyOn(material, 'openFromComponent');
    void snackbar.show('Raum gelöscht', { action: 'Rückgängig', politeness: 'assertive' });
    expect(open.mock.calls[0]![1]!.duration).toBeUndefined();
    expect(open.mock.calls[0]![1]!.politeness).toBe('assertive');
  });

  it('shows the action and a close button for messages with an action', async () => {
    const { snackbar } = setup();
    void snackbar.show('Raum gelöscht', { action: 'Rückgängig' });
    await settle();
    expect(document.querySelector('mat-snack-bar-container')?.textContent).toContain(
      'Raum gelöscht',
    );
    expect(buttonNamed('Rückgängig')).toBeDefined();
    expect(buttonNamed('Schließen')).toBeDefined();
  });

  it('names the close button in English', async () => {
    const { snackbar } = setup('en');
    void snackbar.show('Room deleted', { action: 'Undo' });
    await settle();
    expect(buttonNamed('Close')).toBeDefined();
  });

  it('has no close button without an action', async () => {
    const { snackbar } = setup();
    void snackbar.show('Gespeichert');
    await settle();
    expect(document.querySelector('mat-snack-bar-container')?.textContent).toContain('Gespeichert');
    expect(buttons()).toHaveLength(0);
  });

  it('resolves with action when the action is pressed', async () => {
    const { snackbar } = setup();
    const result = snackbar.show('Raum gelöscht', { action: 'Rückgängig' });
    await settle();
    buttonNamed('Rückgängig')!.click();
    await expect(result).resolves.toBe('action');
  });

  it('resolves with dismissed when it is closed', async () => {
    const { snackbar } = setup();
    const result = snackbar.show('Raum gelöscht', { action: 'Rückgängig' });
    await settle();
    buttonNamed('Schließen')!.click();
    await expect(result).resolves.toBe('dismissed');
  });
});
