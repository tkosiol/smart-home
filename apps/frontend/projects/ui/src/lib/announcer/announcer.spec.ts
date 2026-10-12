import { LiveAnnouncer } from '@angular/cdk/a11y';
import { TestBed } from '@angular/core/testing';
import { UiAnnouncer } from './announcer';

describe('UiAnnouncer', () => {
  it('announces politely by default', async () => {
    const live = TestBed.inject(LiveAnnouncer);
    const spy = vi.spyOn(live, 'announce').mockResolvedValue();
    await TestBed.inject(UiAnnouncer).announce('Gespeichert');
    expect(spy).toHaveBeenCalledWith('Gespeichert', 'polite');
  });

  it('announces assertively on request', async () => {
    const live = TestBed.inject(LiveAnnouncer);
    const spy = vi.spyOn(live, 'announce').mockResolvedValue();
    await TestBed.inject(UiAnnouncer).announce('Verbindung verloren', 'assertive');
    expect(spy).toHaveBeenCalledWith('Verbindung verloren', 'assertive');
  });
});
