import { TestBed } from '@angular/core/testing';
import { UiAnnouncer } from './announcer';

const region = () => document.querySelector<HTMLElement>('.ui-announcer');

describe('UiAnnouncer', () => {
  afterEach(() => {
    region()?.remove();
  });

  it('announces politely by default in one live region at the end of the body', async () => {
    const announcer = TestBed.inject(UiAnnouncer);
    expect(region()).toBeNull();
    await announcer.announce('Gespeichert');
    expect(region()?.textContent).toBe('Gespeichert');
    expect(region()?.getAttribute('aria-live')).toBe('polite');
    expect(region()?.getAttribute('aria-atomic')).toBe('true');
    expect(region()?.parentElement).toBe(document.body);
    await announcer.announce('Gelöscht');
    expect(document.querySelectorAll('.ui-announcer')).toHaveLength(1);
    expect(region()?.textContent).toBe('Gelöscht');
  });

  it('announces assertively on request', async () => {
    await TestBed.inject(UiAnnouncer).announce('Verbindung verloren', 'assertive');
    expect(region()?.textContent).toBe('Verbindung verloren');
    expect(region()?.getAttribute('aria-live')).toBe('assertive');
  });

  it('clears the region first so the same text is read again', async () => {
    vi.useFakeTimers();
    try {
      const announcer = TestBed.inject(UiAnnouncer);
      void announcer.announce('Gespeichert');
      vi.advanceTimersByTime(100);
      expect(region()?.textContent).toBe('Gespeichert');
      const second = announcer.announce('Gespeichert');
      expect(region()?.textContent).toBe('');
      vi.advanceTimersByTime(100);
      await second;
      expect(region()?.textContent).toBe('Gespeichert');
    } finally {
      vi.useRealTimers();
    }
  });
});
