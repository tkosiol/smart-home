import { browserTimeZone, timeZoneOptions } from './time-zones';

describe('time zones', () => {
  it('lists the zones of the browser, sorted, with readable labels', () => {
    const options = timeZoneOptions();
    expect(options.find((option) => option.value === 'America/New_York')?.label).toBe(
      'America/New York',
    );
    const values = options.map((option) => option.value);
    expect(values).toEqual([...values].sort());
    expect(new Set(values).size).toBe(values.length);
  });

  it('always offers UTC and what is asked to include, once', () => {
    const values = timeZoneOptions('Etc/Unknown-Zone', 'Europe/Berlin').map((o) => o.value);
    expect(values).toContain('UTC');
    expect(values).toContain('Etc/Unknown-Zone');
    expect(values.filter((value) => value === 'Europe/Berlin')).toHaveLength(1);
  });

  it('knows the browser zone', () => {
    expect(browserTimeZone()).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });
});
