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
    });
    expect(store.loadPersonal()).toBeNull();
    expect(() => store.savePersonal({ mode: 'light', contrast: 'system' })).not.toThrow();
  });
});
