import type { Me } from '@smart/contracts';
import { DEFAULT_PERSONAL_APPEARANCE } from '@smart/contracts';
import { LocalStorageMeCache } from './me-cache';

const me: Me = {
  id: '5d7c6c8e-0000-4000-8000-000000000001',
  email: 'till@example.org',
  displayName: 'Till',
  locale: 'de',
  appearance: DEFAULT_PERSONAL_APPEARANCE,
  isPlatformAdmin: false,
};

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

describe('LocalStorageMeCache', () => {
  it('stores the user under smart.me and reads it back', () => {
    const storage = memoryStorage();
    const cache = new LocalStorageMeCache(storage);
    cache.save(me);
    expect(storage.data.has('smart.me')).toBe(true);
    expect(cache.load()).toEqual(me);
  });

  it('keeps only the fields of the schema', () => {
    const storage = memoryStorage();
    new LocalStorageMeCache(storage).save({ ...me, sessionToken: 'secret' } as Me);
    const stored = JSON.parse(storage.data.get('smart.me') ?? '{}') as Record<string, unknown>;
    expect(Object.keys(stored).sort()).toEqual(
      ['appearance', 'displayName', 'email', 'id', 'isPlatformAdmin', 'locale'].sort(),
    );
  });

  it.each([
    ['broken JSON', '{'],
    ['the wrong shape', '{"id":1}'],
    ['nothing useful', 'null'],
  ])('treats %s as no copy', (_name, raw) => {
    expect(new LocalStorageMeCache(memoryStorage({ 'smart.me': raw })).load()).toBeNull();
  });

  it('clear removes the copy; clearThemeBoot removes only the theme cache', () => {
    const storage = memoryStorage({
      'smart.me': JSON.stringify(me),
      'smart.theme.boot': '{}',
      other: 'x',
    });
    const cache = new LocalStorageMeCache(storage);
    cache.clearThemeBoot();
    expect([...storage.data.keys()].sort()).toEqual(['other', 'smart.me']);
    cache.clear();
    expect([...storage.data.keys()]).toEqual(['other']);
  });

  it('never throws when the storage does', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    const cache = new LocalStorageMeCache(broken);
    expect(cache.load()).toBeNull();
    expect(() => {
      cache.save(me);
      cache.clear();
      cache.clearThemeBoot();
    }).not.toThrow();
  });
});
