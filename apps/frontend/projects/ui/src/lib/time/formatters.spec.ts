import { formatDateTime, formatRelativeTime } from './formatters';

const BERLIN = 'Europe/Berlin';

describe('formatDateTime', () => {
  it('shows the household time, not the browser time', () => {
    expect(formatDateTime('2026-10-11T12:00:00Z', 'medium', 'de', BERLIN)).toBe(
      '11.10.2026, 14:00',
    );
    expect(formatDateTime('2026-10-11T12:00:00Z', 'medium', 'de', 'Pacific/Chatham')).toBe(
      '12.10.2026, 01:45',
    );
  });

  it('handles the spring gap and the autumn repeat in Berlin', () => {
    expect(formatDateTime('2026-03-29T00:30:00Z', 'time', 'de', BERLIN)).toBe('01:30');
    expect(formatDateTime('2026-03-29T01:30:00Z', 'time', 'de', BERLIN)).toBe('03:30');
    expect(formatDateTime('2026-10-25T00:30:00Z', 'time', 'de', BERLIN)).toBe('02:30');
    expect(formatDateTime('2026-10-25T01:30:00Z', 'time', 'de', BERLIN)).toBe('02:30');
  });

  it('offers short, date and time styles and follows the locale', () => {
    expect(formatDateTime('2026-10-11T12:00:00Z', 'short', 'de', BERLIN)).toBe('11.10.26, 14:00');
    expect(formatDateTime('2026-10-11T12:00:00Z', 'date', 'de', BERLIN)).toBe('11.10.2026');
    expect(formatDateTime('2026-10-11T12:00:00Z', 'medium', 'en', BERLIN)).toMatch(
      /^Oct 11, 2026, 2:00\sPM$/,
    );
  });

  it.each(['', 'gestern', '2026-10-11 12:00', '2026-10-11T12:00:00', '2026-10-11T14:00:00+02:00'])(
    'returns an empty string for %j (only UTC with Z is valid)',
    (value) => {
      expect(formatDateTime(value, 'medium', 'de', BERLIN)).toBe('');
    },
  );

  it('returns an empty string for null and undefined', () => {
    expect(formatDateTime(null, 'medium', 'de', BERLIN)).toBe('');
    expect(formatDateTime(undefined, 'medium', 'de', BERLIN)).toBe('');
  });
});

describe('formatRelativeTime', () => {
  const now = Date.parse('2026-10-11T12:00:00Z');
  const ago = (seconds: number) => new Date(now - seconds * 1000).toISOString();

  it.each([
    [10, 'jetzt'],
    [50, 'vor 1 Minute'],
    [5 * 60, 'vor 5 Minuten'],
    [3 * 3600, 'vor 3 Stunden'],
  ])('%i seconds ago is %j', (seconds, expected) => {
    expect(formatRelativeTime(ago(seconds), now, 'de', BERLIN)).toBe(expected);
  });

  it('uses calendar days in the household time zone', () => {
    // 12:00Z = 14:00 in Berlin; 23 hours earlier is 15:00 the day before → "gestern".
    expect(formatRelativeTime(ago(23 * 3600), now, 'de', BERLIN)).toBe('gestern');
    expect(formatRelativeTime(ago(2 * 86400), now, 'de', BERLIN)).toBe('vorgestern');
    expect(formatRelativeTime(ago(4 * 86400), now, 'de', BERLIN)).toBe('vor 4 Tagen');
  });

  it('switches to weeks, months and years', () => {
    expect(formatRelativeTime(ago(14 * 86400), now, 'de', BERLIN)).toBe('vor 2 Wochen');
    expect(formatRelativeTime(ago(90 * 86400), now, 'de', BERLIN)).toBe('vor 3 Monaten');
    expect(formatRelativeTime(ago(400 * 86400), now, 'de', BERLIN)).toBe('letztes Jahr');
  });

  it('describes the future too and follows the locale', () => {
    expect(formatRelativeTime(new Date(now + 5 * 60 * 1000).toISOString(), now, 'de', BERLIN)).toBe(
      'in 5 Minuten',
    );
    expect(formatRelativeTime(ago(5 * 60), now, 'en', BERLIN)).toBe('5 minutes ago');
  });

  it('returns an empty string for invalid values', () => {
    expect(formatRelativeTime('2026-10-11T12:00:00', now, 'de', BERLIN)).toBe('');
    expect(formatRelativeTime(null, now, 'de', BERLIN)).toBe('');
  });
});
