import { chartAxisLabels, localMinutesOfDay, rangeDurationMs } from './chart-axis';

const NOW = '2026-10-27T12:32:00.000Z'; // 14:32 in Berlin (CEST)
const from = (range: '24h' | '7d' | '28d') =>
  new Date(Date.parse(NOW) - rangeDurationMs(range)).toISOString();

const texts = (labels: { text: string }[]) => labels.map((label) => label.text);

describe('chartAxisLabels', () => {
  it('marks every sixth local hour for 24 hours', () => {
    const labels = chartAxisLabels('24h', from('24h'), NOW, 'Europe/Berlin', false, 'de');
    expect(texts(labels)).toEqual(['18 Uhr', '0 Uhr', '6 Uhr', '12 Uhr']);
    for (const { t } of labels) {
      expect(Date.parse(t)).toBeGreaterThanOrEqual(Date.parse(from('24h')));
      expect(Date.parse(t)).toBeLessThanOrEqual(Date.parse(NOW));
    }
  });

  it('follows the locale', () => {
    const labels = chartAxisLabels('24h', from('24h'), NOW, 'Europe/Berlin', false, 'en');
    expect(texts(labels)).toEqual(['6 PM', '12 AM', '6 AM', '12 PM']);
  });

  it('names the days of 7 days in the middle of the day and ends with "Today"', () => {
    const labels = chartAxisLabels('7d', from('7d'), NOW, 'Europe/Berlin', false, 'de');
    // Tue 20 Oct has only 9.5 hours in range and is left out; today has 14.5
    expect(texts(labels)).toEqual(['Mi', 'Do', 'Fr', 'Sa', 'So', 'Mo', 'Heute']);
    expect(texts(chartAxisLabels('7d', from('7d'), NOW, 'Europe/Berlin', false, 'en')).at(-1)).toBe(
      'Today',
    );
  });

  it('puts the day label in the middle of the local day', () => {
    const [wednesday] = chartAxisLabels('7d', from('7d'), NOW, 'Europe/Berlin', false, 'de');
    // Wed 21 Oct, local 00:00 is 22:00Z the day before; the middle is 12:00 local = 10:00Z
    expect(wednesday!.t).toBe('2026-10-21T10:00:00.000Z');
  });

  it('shows the weekday instead of "Today" on narrow widths', () => {
    const labels = chartAxisLabels('7d', from('7d'), NOW, 'Europe/Berlin', true, 'de');
    expect(texts(labels)).toEqual(['Mi', 'Do', 'Fr', 'Sa', 'So', 'Mo', 'Di']);
  });

  it('labels the Mondays of 4 weeks and "Today", dropping a Monday too close to it', () => {
    const labels = chartAxisLabels('28d', from('28d'), NOW, 'Europe/Berlin', false, 'de');
    // Mon 26 Oct lies 1.6 days before the end and is dropped
    expect(texts(labels)).toEqual(['5. Okt.', '12. Okt.', '19. Okt.', 'Heute']);
    expect(labels.at(-1)!.t).toBe(NOW);
  });

  it('shows every second Monday on narrow widths', () => {
    const labels = chartAxisLabels('28d', from('28d'), NOW, 'Europe/Berlin', true, 'de');
    expect(texts(labels)).toEqual(['5. Okt.', '19. Okt.', 'Heute']);
  });

  it('keeps a Monday that is far enough from "Today"', () => {
    const to = '2026-10-29T12:32:00.000Z'; // Thursday
    const start = new Date(Date.parse(to) - rangeDurationMs('28d')).toISOString();
    const labels = chartAxisLabels('28d', start, to, 'Europe/Berlin', false, 'de');
    expect(texts(labels)).toEqual(['5. Okt.', '12. Okt.', '19. Okt.', '26. Okt.', 'Heute']);
  });

  it('uses whole local hours in a zone with a 45-minute offset (Pacific/Chatham)', () => {
    const zone = 'Pacific/Chatham';
    const labels = chartAxisLabels('24h', from('24h'), NOW, zone, false, 'en');
    expect(labels.length).toBeGreaterThanOrEqual(3);
    for (const { t } of labels) {
      const minutes = localMinutesOfDay(Date.parse(t), zone);
      expect(minutes % 360).toBe(0);
    }
  });

  it('names the local days in Pacific/Chatham, where the local day differs from UTC', () => {
    const zone = 'Pacific/Chatham'; // 02:17 on Wed 28 Oct local: that day has too little in range
    const labels = chartAxisLabels('7d', from('7d'), NOW, zone, false, 'en');
    expect(texts(labels)).toEqual(['Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Mon', 'Tue']);
    expect(localMinutesOfDay(Date.parse(labels[5]!.t), zone)).toBe(720);
  });

  it('gives no labels for an empty or inverted range', () => {
    expect(chartAxisLabels('24h', NOW, NOW, 'Europe/Berlin', false, 'de')).toEqual([]);
  });
});
