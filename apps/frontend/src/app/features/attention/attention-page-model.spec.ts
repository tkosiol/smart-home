import { attentionItem } from './attention-testing';
import {
  filterAttention,
  filterCounts,
  groupTitleKey,
  kindsFromParam,
  sectionsOf,
} from './attention-page-model';

const items = [
  attentionItem('device_silent', 'Sensor 9'),
  attentionItem('soil_dry', 'Ficus', { value: 18, unit: '%' }),
  attentionItem('battery_low', 'Sensor 1', { value: 9, unit: '%' }),
  attentionItem('soil_dry', 'Palme', { value: 20, unit: '%' }),
  attentionItem('contact_open', 'Fenster'),
];

describe('kindsFromParam', () => {
  it('takes known kinds, once, in the order given', () => {
    expect(kindsFromParam('soil_dry,battery_low,soil_dry')).toEqual(['soil_dry', 'battery_low']);
  });

  it('drops what is no kind and gives nothing without a parameter', () => {
    expect(kindsFromParam('nonsense,soil_wet')).toEqual(['soil_wet']);
    expect(kindsFromParam('')).toEqual([]);
    expect(kindsFromParam(null)).toEqual([]);
    expect(kindsFromParam('toString,__proto__')).toEqual([]);
  });
});

describe('filterCounts', () => {
  it('counts the notices by severity and by kind in the order of the notices', () => {
    expect(filterCounts(items)).toEqual({
      all: 5,
      severities: { critical: 1, warning: 3, info: 1 },
      kinds: [
        { kind: 'device_silent', count: 1 },
        { kind: 'soil_dry', count: 2 },
        { kind: 'battery_low', count: 1 },
        { kind: 'contact_open', count: 1 },
      ],
    });
  });
});

describe('filterAttention', () => {
  const names = (list: typeof items) => list.map((item) => item.name);

  it('shows everything without a filter or with "all"', () => {
    expect(filterAttention(items, ['all'], [])).toHaveLength(5);
    expect(filterAttention(items, [], [])).toHaveLength(5);
  });

  it('keeps the severities chosen', () => {
    expect(names(filterAttention(items, ['critical', 'info'], []))).toEqual([
      'Sensor 9',
      'Fenster',
    ]);
  });

  it('keeps the kinds chosen, and both filters have to fit', () => {
    expect(names(filterAttention(items, ['all'], ['soil_dry', 'contact_open']))).toEqual([
      'Ficus',
      'Palme',
      'Fenster',
    ]);
    expect(filterAttention(items, ['critical'], ['soil_dry'])).toEqual([]);
  });

  it('ignores kinds that no notice has', () => {
    expect(filterAttention(items, ['all'], ['soil_wet'])).toHaveLength(5);
    expect(names(filterAttention(items, ['all'], ['soil_wet', 'battery_low']))).toEqual([
      'Sensor 1',
    ]);
  });
});

describe('sectionsOf', () => {
  it('makes a section per severity, most urgent first, with a card per kind', () => {
    const sections = sectionsOf(items, 'de');
    expect(sections.map((section) => section.severity)).toEqual(['critical', 'warning', 'info']);
    expect(sections[1]!.cards.map((card) => card.kind)).toEqual(['soil_dry', 'battery_low']);
    expect(sections[1]!.cards[0]!.notices.map((notice) => notice.title)).toEqual([
      { text: 'Ficus' },
      { text: 'Palme' },
    ]);
  });

  it('leaves out a severity without notices', () => {
    expect(sectionsOf([items[1]!], 'de').map((section) => section.severity)).toEqual(['warning']);
    expect(sectionsOf([], 'de')).toEqual([]);
  });

  it('gives a notice its value, also a critical one, and the devices a gateway hides', () => {
    const [critical] = sectionsOf(
      [
        attentionItem('gateway_offline', 'Pi', { params: { affectedDevices: 3 } }),
        attentionItem('device_silent', 'Sensor', { value: 5, unit: '%' }),
      ],
      'de',
    );
    const [gateway, silent] = critical!.cards.flatMap((card) => card.notices);
    expect(gateway).toMatchObject({
      affectedDevices: 3,
      value: null,
      target: { kind: 'gateways' },
    });
    expect(silent).toMatchObject({ affectedDevices: null, value: expect.stringContaining('5') });
  });
});

describe('groupTitleKey', () => {
  it('has a title for every kind and falls back for an unknown one', () => {
    expect(groupTitleKey('soil_dry')).toBe('app.attention.group.soil_dry');
    expect(groupTitleKey('something_new' as never)).toBe('app.attention.group.unknown');
  });
});
