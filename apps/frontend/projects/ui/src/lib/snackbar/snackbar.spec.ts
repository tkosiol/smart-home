import { TestBed } from '@angular/core/testing';
import { MatSnackBar, type MatSnackBarConfig } from '@angular/material/snack-bar';
import { Subject } from 'rxjs';
import { UiSnackbar } from './snackbar';

class FakeSnackBar {
  readonly calls: { message: string; action?: string; config?: MatSnackBarConfig }[] = [];
  readonly dismissed = new Subject<{ dismissedByAction: boolean }>();
  open(message: string, action?: string, config?: MatSnackBarConfig) {
    this.calls.push({ message, action, config });
    return { afterDismissed: () => this.dismissed.asObservable() };
  }
}

function setup() {
  const fake = new FakeSnackBar();
  TestBed.configureTestingModule({ providers: [{ provide: MatSnackBar, useValue: fake }] });
  return { fake, snackbar: TestBed.inject(UiSnackbar) };
}

describe('UiSnackbar', () => {
  it('closes plain messages after four seconds, politely', () => {
    const { fake, snackbar } = setup();
    void snackbar.show('Gespeichert');
    expect(fake.calls[0]).toEqual({
      message: 'Gespeichert',
      action: undefined,
      config: { duration: 4000, politeness: 'polite' },
    });
  });

  it('keeps messages with an action open until the user reacts', () => {
    const { fake, snackbar } = setup();
    void snackbar.show('Raum gelöscht', { action: 'Rückgängig' });
    expect(fake.calls[0]!.config!.duration).toBeUndefined();
  });

  it('resolves with how the message was closed', async () => {
    const { fake, snackbar } = setup();
    const acted = snackbar.show('Raum gelöscht', { action: 'Rückgängig' });
    fake.dismissed.next({ dismissedByAction: true });
    await expect(acted).resolves.toBe('action');
    const ignored = snackbar.show('Gespeichert');
    fake.dismissed.next({ dismissedByAction: false });
    await expect(ignored).resolves.toBe('dismissed');
  });

  it('honours an explicit duration', () => {
    const { fake, snackbar } = setup();
    void snackbar.show('Gespeichert', { durationMs: 8000 });
    expect(fake.calls[0]!.config!.duration).toBe(8000);
  });
});
