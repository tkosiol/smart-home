import { LocalStorageLanguageStore } from './language-store';

const storage = (initial: Record<string, string> = {}) => {
  const data = { ...initial };
  return {
    data,
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => {
      data[key] = value;
    },
  };
};

describe('LocalStorageLanguageStore', () => {
  it('reads and writes the chosen language', () => {
    const backing = storage();
    const store = new LocalStorageLanguageStore(backing);
    store.save('en');
    expect(backing.data['smart.language']).toBe('en');
    expect(store.load()).toBe('en');
  });

  it.each(['fr', '', 'null'])('ignores the unsupported stored value %j', (value) => {
    expect(new LocalStorageLanguageStore(storage({ 'smart.language': value })).load()).toBeNull();
  });

  it('never throws when storage is blocked', () => {
    const blocked = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('SecurityError');
      },
    };
    const store = new LocalStorageLanguageStore(blocked);
    expect(store.load()).toBeNull();
    expect(() => store.save('en')).not.toThrow();
  });
});
