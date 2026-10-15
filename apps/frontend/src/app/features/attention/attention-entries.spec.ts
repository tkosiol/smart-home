import { entryOf, valueText } from './attention-entries';
import { groupAttention } from './attention-model';
import { attentionItem } from './attention-testing';

const NBSP = String.fromCharCode(0xa0);
const entry = (...items: ReturnType<typeof attentionItem>[]) =>
  entryOf(groupAttention(items)[0]!, 'de');

describe('entryOf', () => {
  it('shows the device of a group with one notice, with its value', () => {
    expect(entry(attentionItem('soil_dry', 'Ficus', { value: 18, unit: '%' }))).toEqual({
      id: 'soil_dry:Ficus',
      icon: 'water_drop',
      tone: 'dry-container',
      critical: false,
      titleKey: 'app.attention.kind.soil_dry.one',
      titleParams: { name: 'Ficus' },
      subtitle: null,
      value: `18${NBSP}%`,
      target: { kind: 'device', deviceId: 'dev-Ficus' },
    });
  });

  it('shows a group of several as a count with the names beneath, leading to the notices of the kind', () => {
    expect(
      entry(
        attentionItem('soil_dry', 'Ficus', { value: 18, unit: '%' }),
        attentionItem('soil_dry', 'Monstera', { value: 20, unit: '%' }),
      ),
    ).toMatchObject({
      titleKey: 'app.attention.kind.soil_dry.many',
      titleParams: { count: 2 },
      subtitle: { text: 'Ficus, Monstera' },
      value: null,
      target: { kind: 'group', attentionKind: 'soil_dry' },
    });
  });

  it('uses the strong error container for critical notices and shows no value', () => {
    expect(entry(attentionItem('device_silent', 'Sensor', { value: 3, unit: '%' }))).toMatchObject({
      tone: 'error',
      critical: true,
      icon: 'wifi_off',
      value: null,
    });
  });

  it('says how many devices an offline gateway takes with it', () => {
    const gateway = attentionItem('gateway_offline', 'Pi', { params: { affectedDevices: 18 } });
    expect(entry(gateway)).toMatchObject({
      titleKey: 'app.attention.kind.gateway_offline.one',
      subtitle: { key: 'app.attention.subtitle.devices', params: { count: 18 } },
      target: { kind: 'gateways' },
    });
    expect(
      entry(attentionItem('gateway_offline', 'Pi', { params: { affectedDevices: 1 } })).subtitle,
    ).toEqual({ key: 'app.attention.subtitle.devicesOne', params: { count: 1 } });
    expect(
      entry(attentionItem('gateway_offline', 'Pi', { params: { affectedDevices: 0 } })).subtitle,
    ).toBeNull();
  });

  it('sends new hardware to the devices page', () => {
    expect(entry(attentionItem('hardware_new', 'Sensor 7'))).toMatchObject({
      target: { kind: 'devices' },
      icon: 'devices',
    });
  });

  it('picks the text of an expiring certificate or CRL', () => {
    const cert = (params: Record<string, unknown>, name = 'Pi') =>
      entry(attentionItem('cert_expiring', name, { params })).titleKey;
    expect(cert({ subject: 'certificate', expired: false })).toBe(
      'app.attention.kind.cert_expiring.one',
    );
    expect(cert({ subject: 'certificate', expired: true })).toBe(
      'app.attention.kind.cert_expiring.expired',
    );
    expect(cert({ subject: 'crl', expired: false }, 'CRL')).toBe(
      'app.attention.kind.cert_expiring.crl',
    );
    expect(cert({ subject: 'crl', expired: true }, 'CRL')).toBe(
      'app.attention.kind.cert_expiring.crlExpired',
    );
  });

  it('shows a kind it does not know by its name', () => {
    const unknown = attentionItem('soil_dry', 'Ficus');
    const group = {
      kind: 'moss' as never,
      severity: 'info' as const,
      items: [{ ...unknown, kind: 'moss' as never }],
    };
    expect(entryOf(group, 'de')).toMatchObject({
      titleKey: 'app.attention.kind.unknown.one',
      titleParams: { name: 'Ficus' },
      icon: 'info',
    });
  });
});

describe('valueText', () => {
  it('formats in the language of the user', () => {
    const item = attentionItem('soil_dry', 'A', { value: 18.25, unit: '%' });
    expect(valueText(item, 'de')).toBe(`18,3${NBSP}%`);
    expect(valueText(item, 'en')).toBe(`18.3${NBSP}%`);
  });

  it('has no text without a value, and no unit without one', () => {
    expect(valueText(attentionItem('hardware_new', 'A'), 'de')).toBeNull();
    expect(valueText(attentionItem('soil_dry', 'A', { value: 5 }), 'de')).toBe('5');
  });
});
