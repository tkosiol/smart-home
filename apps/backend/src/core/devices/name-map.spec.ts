import { NameMap } from './name-map.js';

describe('NameMap', () => {
  it('keeps the names of each gateway apart', () => {
    const names = new NameMap();
    names.replace('gw-a', [{ friendlyName: 'lamp', id: 'h1' }]);
    names.replace('gw-b', [{ friendlyName: 'lamp', id: 'h2' }]);
    expect(names.lookup('gw-a', 'lamp')).toBe('h1');
    expect(names.lookup('gw-b', 'lamp')).toBe('h2');
    expect(names.lookup('gw-c', 'lamp')).toBeUndefined();
  });

  it('forgets names that a new list no longer has', () => {
    const names = new NameMap();
    names.replace('gw-a', [{ friendlyName: 'old', id: 'h1' }]);
    names.replace('gw-a', [{ friendlyName: 'new', id: 'h1' }]);
    expect(names.lookup('gw-a', 'old')).toBeUndefined();
    expect(names.lookup('gw-a', 'new')).toBe('h1');
  });

  it('moves a renamed piece of hardware and drops the old name', () => {
    const names = new NameMap();
    names.set('gw-a', 'old', 'h1');
    names.rename('gw-a', 'old', 'new', 'h1');
    expect(names.lookup('gw-a', 'old')).toBeUndefined();
    expect(names.lookup('gw-a', 'new')).toBe('h1');
  });

  it('removes one name and forgets a whole gateway', () => {
    const names = new NameMap();
    names.set('gw-a', 'x', 'h1');
    names.set('gw-a', 'y', 'h2');
    names.remove('gw-a', 'x');
    expect(names.lookup('gw-a', 'x')).toBeUndefined();
    expect(names.lookup('gw-a', 'y')).toBe('h2');
    names.forget('gw-a');
    expect(names.lookup('gw-a', 'y')).toBeUndefined();
  });
});
