import { LocalStoragePendingPreferences } from './pending-preferences';

class MemoryStorage {
  data = new Map<string, string>();
  getItem = (key: string) => this.data.get(key) ?? null;
  setItem = (key: string, value: string) => void this.data.set(key, value);
  removeItem = (key: string) => void this.data.delete(key);
}

describe('LocalStoragePendingPreferences', () => {
  it('keeps the user together with the unsent changes', () => {
    const store = new LocalStoragePendingPreferences(new MemoryStorage());
    store.save({ userId: 'u1', locale: 'en' });
    expect(store.load()).toEqual({ userId: 'u1', locale: 'en' });
    store.clear();
    expect(store.load()).toBeNull();
  });

  it('ignores a record without a user (written by an older version)', () => {
    const storage = new MemoryStorage();
    storage.setItem('smart.me.pending', JSON.stringify({ locale: 'en' }));
    expect(new LocalStoragePendingPreferences(storage).load()).toBeNull();
  });

  it('ignores garbage and unknown languages', () => {
    const storage = new MemoryStorage();
    const store = new LocalStoragePendingPreferences(storage);
    storage.setItem('smart.me.pending', 'nope');
    expect(store.load()).toBeNull();
    storage.setItem('smart.me.pending', JSON.stringify({ userId: 'u1', locale: 'fr' }));
    expect(store.load()).toBeNull();
  });
});
