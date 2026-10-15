import { attentionChange, groupAttention, heroModel } from './attention-model';
import { attentionItem, manyNotices } from './attention-testing';

describe('groupAttention', () => {
  it('groups by kind, a group at the place of its first notice', () => {
    const items = [
      attentionItem('device_silent', 'A'),
      attentionItem('soil_dry', 'B'),
      attentionItem('device_silent', 'C'),
      attentionItem('soil_dry', 'D'),
    ];
    const groups = groupAttention(items);
    expect(groups.map((g) => [g.kind, g.severity, g.items.map((i) => i.name)])).toEqual([
      ['device_silent', 'critical', ['A', 'C']],
      ['soil_dry', 'warning', ['B', 'D']],
    ]);
  });

  it('is empty without notices', () => {
    expect(groupAttention([])).toEqual([]);
  });
});

describe('heroModel', () => {
  it('counts notices, not groups: a gateway, 12 dry plants, 4 batteries, 3 windows', () => {
    const items = manyNotices();
    expect(items).toHaveLength(20);
    const hero = heroModel(items);
    expect(hero.count).toBe(20);
    expect(hero.criticalCount).toBe(1);
    expect(hero.tone).toBe('critical');
    expect(hero.groups.map((g) => [g.kind, g.items.length])).toEqual([
      ['gateway_offline', 1],
      ['soil_dry', 12],
      ['battery_low', 4],
    ]);
    expect(hero.hiddenGroups).toBe(1);
  });

  it('shows at most three groups, whatever the limit says by default', () => {
    const items = [
      attentionItem('device_silent', 'A'),
      attentionItem('soil_dry', 'B'),
      attentionItem('soil_wet', 'C'),
      attentionItem('battery_low', 'D'),
      attentionItem('contact_open', 'E'),
      attentionItem('hardware_new', 'F'),
    ];
    const hero = heroModel(items);
    expect(hero.groups).toHaveLength(3);
    expect(hero.hiddenGroups).toBe(3);
    expect(heroModel(items, { limit: 6 })).toMatchObject({ hiddenGroups: 0 });
    expect(heroModel(items, { limit: 6 }).groups).toHaveLength(6);
  });

  it('has no hidden groups when everything fits', () => {
    const hero = heroModel([attentionItem('soil_dry', 'A'), attentionItem('soil_dry', 'B')]);
    expect(hero.hiddenGroups).toBe(0);
    expect(hero.groups).toHaveLength(1);
  });

  it('is attention while only warnings and infos are open', () => {
    const hero = heroModel([
      attentionItem('soil_dry', 'A'),
      attentionItem('battery_low', 'B'),
      attentionItem('hardware_new', 'C'),
    ]);
    expect(hero).toMatchObject({ tone: 'attention', count: 3, criticalCount: 0 });
  });

  it('is critical as soon as one critical notice is open', () => {
    expect(heroModel([attentionItem('device_silent', 'A')])).toMatchObject({
      tone: 'critical',
      count: 1,
      criticalCount: 1,
    });
  });

  it('is calm without notices', () => {
    expect(heroModel([])).toEqual({
      tone: 'calm',
      count: 0,
      criticalCount: 0,
      groups: [],
      hiddenGroups: 0,
    });
  });
});

describe('attentionChange', () => {
  const dry = attentionItem('soil_dry', 'A');
  const silent = attentionItem('device_silent', 'B');
  const gateway = attentionItem('gateway_offline', 'Pi');

  it('reports a critical notice that appeared', () => {
    expect(attentionChange([dry], [dry, silent])).toEqual({ newCritical: [silent], changed: true });
  });

  it('reports a change that is not critical', () => {
    expect(attentionChange([dry, silent], [silent])).toEqual({ newCritical: [], changed: true });
    expect(attentionChange([silent], [silent, dry])).toEqual({ newCritical: [], changed: true });
  });

  it('is quiet while the same notices are open, also when values change', () => {
    const dryer = { ...dry, value: 5 };
    expect(attentionChange([dry, gateway], [dryer, gateway])).toEqual({
      newCritical: [],
      changed: false,
    });
  });

  it('does not call a critical notice that was there before new', () => {
    expect(attentionChange([silent], [silent, dry]).newCritical).toEqual([]);
  });
});
