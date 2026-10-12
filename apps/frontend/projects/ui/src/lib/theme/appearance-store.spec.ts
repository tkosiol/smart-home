import { DEFAULT_INSTANCE_APPEARANCE } from '@smart/contracts';
import { LocalStorageAppearanceStore } from './appearance-store';

describe('LocalStorageAppearanceStore', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips personal and instance appearance', () => {
    const store = new LocalStorageAppearanceStore();
    store.savePersonal({ mode: 'dark', contrast: 'high' });
    store.saveInstance(DEFAULT_INSTANCE_APPEARANCE);
    expect(store.loadPersonal()).toEqual({ mode: 'dark', contrast: 'high' });
    expect(store.loadInstance()).toEqual(DEFAULT_INSTANCE_APPEARANCE);
  });

  it.each(['not json', '{"mode":"neon","contrast":"system"}', 'null'])(
    'returns null for unusable personal data %j',
    (raw) => {
      localStorage.setItem('smart.appearance.personal', raw);
      expect(new LocalStorageAppearanceStore().loadPersonal()).toBeNull();
    },
  );

  it('survives storage that throws', () => {
    const store = new LocalStorageAppearanceStore({
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    });
    expect(store.loadPersonal()).toBeNull();
    expect(() => store.savePersonal({ mode: 'light', contrast: 'system' })).not.toThrow();
  });

  it('survives browsers that block access to localStorage itself', () => {
    const blocked = vi.spyOn(globalThis, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    try {
      const store = new LocalStorageAppearanceStore();
      expect(store.loadPersonal()).toBeNull();
      expect(store.loadInstance()).toBeNull();
      expect(() => store.savePersonal({ mode: 'light', contrast: 'system' })).not.toThrow();
      expect(() =>
        store.saveBootCache({
          v: 2,
          mode: 'light',
          followsSystemContrast: false,
          light: {},
          dark: {},
        }),
      ).not.toThrow();
    } finally {
      blocked.mockRestore();
    }
  });

  it('keeps mode and contrast when only the stored colors are invalid', () => {
    localStorage.setItem(
      'smart.appearance.personal',
      JSON.stringify({ mode: 'dark', contrast: 'high', colors: { seed: 'blue' } }),
    );
    expect(new LocalStorageAppearanceStore().loadPersonal()).toEqual({
      mode: 'dark',
      contrast: 'high',
    });
  });

  it('forgets stored appearance on clear', () => {
    const store = new LocalStorageAppearanceStore();
    store.savePersonal({ mode: 'dark', contrast: 'high' });
    store.saveInstance(DEFAULT_INSTANCE_APPEARANCE);
    store.clearPersonal();
    store.clearInstance();
    expect(store.loadPersonal()).toBeNull();
    expect(store.loadInstance()).toBeNull();
  });

  it('reports changes another tab makes to its keys only', () => {
    const store = new LocalStorageAppearanceStore();
    const seen: string[] = [];
    const stop = store.watch((key) => seen.push(key));
    window.dispatchEvent(new StorageEvent('storage', { key: 'smart.appearance.personal' }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'smart.appearance.instance' }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'smart.theme.boot' }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'other' }));
    // key null: the other tab cleared the whole storage.
    window.dispatchEvent(new StorageEvent('storage', { key: null }));
    stop();
    window.dispatchEvent(new StorageEvent('storage', { key: 'smart.appearance.personal' }));
    expect(seen).toEqual(['personal', 'instance', 'instance', 'personal']);
  });
});
