import type { InstanceAppearance, PersonalAppearance } from '@smart/contracts';
import type { AppearanceKey, AppearanceStore, BootCache } from './appearance-store';

/** In-memory store for tests and Storybook; `emit` simulates a change made in another tab. */
export class MemoryAppearanceStore implements AppearanceStore {
  instance: InstanceAppearance | null = null;
  personal: PersonalAppearance | null = null;
  boot: BootCache | null = null;
  private readonly listeners = new Set<(key: AppearanceKey) => void>();

  loadInstance(): InstanceAppearance | null {
    return this.instance;
  }
  loadPersonal(): PersonalAppearance | null {
    return this.personal;
  }
  saveInstance(value: InstanceAppearance): void {
    this.instance = value;
  }
  savePersonal(value: PersonalAppearance): void {
    this.personal = value;
  }
  clearInstance(): void {
    this.instance = null;
  }
  clearPersonal(): void {
    this.personal = null;
  }
  saveBootCache(value: BootCache): void {
    this.boot = value;
  }
  watch(callback: (key: AppearanceKey) => void): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }
  emit(key: AppearanceKey): void {
    for (const listener of this.listeners) listener(key);
  }
}
