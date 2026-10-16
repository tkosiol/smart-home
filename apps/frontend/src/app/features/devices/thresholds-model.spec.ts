import { effectiveThresholds } from '@smart/contracts';
import { capability, device } from './devices-testing';
import { customKeys, resetPatch, thresholdPatch, thresholdRows } from './thresholds-model';

describe('thresholdRows', () => {
  it('lists what the capabilities allow, with the value in force and the kind default', () => {
    const rows = thresholdRows(
      {
        ...device('d', 'x'),
        thresholds: { batteryMin: 10 },
        effectiveThresholds: effectiveThresholds('soil', { batteryMin: 10 }),
      },
      'de',
    );
    expect(rows.map((row) => [row.key, row.initial, row.custom, row.standard])).toEqual([
      ['soilMoistureMin', '25', false, 25],
      ['soilMoistureMax', '', false, null],
      ['batteryMin', '10', true, 20],
      ['silentMinutes', '120', false, 120],
    ]);
  });

  it('writes the values in the language of the user, without digit grouping', () => {
    const own = {
      ...device('d', 'x'),
      thresholds: { batteryMin: 15.5, silentMinutes: 10080 },
      effectiveThresholds: effectiveThresholds('soil', { batteryMin: 15.5, silentMinutes: 10080 }),
    };
    const initials = (locale: string) =>
      Object.fromEntries(thresholdRows(own, locale).map((row) => [row.key, row.initial]));
    expect(initials('de')).toMatchObject({ batteryMin: '15,5', silentMinutes: '10080' });
    expect(initials('en')).toMatchObject({ batteryMin: '15.5', silentMinutes: '10080' });
  });

  it('counts a null of the device as "not its own"', () => {
    const rows = thresholdRows(
      { ...device('d', 'x'), thresholds: { soilMoistureMin: null } },
      'de',
    );
    expect(customKeys(rows)).toEqual([]);
  });

  it('offers the duration an entry is open only for a contact', () => {
    const window = device('d', 'x', {
      kind: 'contact',
      capabilities: [capability('contact', { kind: 'binary' })],
    });
    expect(thresholdRows(window, 'de').map((row) => row.key)).toEqual([
      'contactOpenMinutes',
      'silentMinutes',
    ]);
  });
});

describe('thresholdPatch', () => {
  const plant = device('d', 'x');
  const rows = thresholdRows(plant, 'de');

  it('is empty when nothing differs, also when the text only has spaces around it', () => {
    expect(thresholdPatch(plant, rows, {})).toEqual({ ok: true, patch: {} });
    expect(thresholdPatch(plant, rows, { soilMoistureMin: ' 25 ' })).toEqual({
      ok: true,
      patch: {},
    });
  });

  it('keeps only the changed values, as numbers, and an empty text as null', () => {
    expect(thresholdPatch(plant, rows, { batteryMin: '15,5', silentMinutes: '60' })).toEqual({
      ok: true,
      patch: { batteryMin: 15.5, silentMinutes: 60 },
    });
    const own = { ...plant, thresholds: { soilMoistureMax: 70 } };
    expect(thresholdPatch(own, thresholdRows(own, 'de'), { soilMoistureMax: '' })).toEqual({
      ok: true,
      patch: { soilMoistureMax: null },
    });
  });

  it('does not send an emptied field that already shows the standard', () => {
    expect(thresholdPatch(plant, rows, { soilMoistureMin: '', soilMoistureMax: '' })).toEqual({
      ok: true,
      patch: {},
    });
  });

  it('compares numbers, not text: "25,0" and "25.0" are the value in force', () => {
    expect(thresholdPatch(plant, rows, { soilMoistureMin: '25,0' })).toEqual({
      ok: true,
      patch: {},
    });
    expect(thresholdPatch(plant, rows, { soilMoistureMin: '25.00' })).toEqual({
      ok: true,
      patch: {},
    });
  });

  it.each([
    ['soilMoistureMin', '101'],
    ['batteryMin', '-1'],
    ['batteryMin', 'ten'],
    ['silentMinutes', '0'],
    ['silentMinutes', '10081'],
    ['silentMinutes', '2,5'],
  ] as const)('refuses %s = "%s"', (key, text) => {
    const result = thresholdPatch(plant, rows, { [key]: text });
    expect(result).toEqual({
      ok: false,
      errors: { [key]: 'app.devices.thresholds.error.invalid' },
    });
  });

  it('accepts the limits of the contract', () => {
    expect(
      thresholdPatch(plant, rows, {
        soilMoistureMin: '0',
        batteryMin: '100',
        silentMinutes: '10080',
      }),
    ).toMatchObject({ ok: true });
  });

  it('refuses a range that ends up empty, at the field that was changed', () => {
    expect(thresholdPatch(plant, rows, { soilMoistureMax: '25' })).toEqual({
      ok: false,
      errors: { soilMoistureMax: 'app.devices.thresholds.error.range' },
    });
    expect(
      thresholdPatch(plant, rows, { soilMoistureMin: '30', soilMoistureMax: '30' }),
    ).toMatchObject({
      ok: false,
      errors: {
        soilMoistureMin: 'app.devices.thresholds.error.range',
        soilMoistureMax: 'app.devices.thresholds.error.range',
      },
    });
  });

  it('accepts a range that is fine once the standard is back', () => {
    const own = {
      ...plant,
      thresholds: { soilMoistureMin: 80 },
      effectiveThresholds: effectiveThresholds('soil', { soilMoistureMin: 80 }),
    };
    // Min 80 and a new max 60 would be empty; resetting the min to the standard (25) makes it fine.
    expect(
      thresholdPatch(own, thresholdRows(own, 'de'), { soilMoistureMin: '', soilMoistureMax: '60' }),
    ).toEqual({
      ok: true,
      patch: { soilMoistureMin: null, soilMoistureMax: 60 },
    });
  });
});

describe('resetPatch', () => {
  it('sets each key to null', () => {
    expect(resetPatch(['batteryMin', 'soilMoistureMax'])).toEqual({
      batteryMin: null,
      soilMoistureMax: null,
    });
  });
});
