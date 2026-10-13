import { importProvidersFrom } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TranslocoTestingModule } from '@jsverse/transloco';
import { DEFAULT_INSTANCE_APPEARANCE, type InstanceAppearance } from '@smart/contracts';
import { APPEARANCE_STORE, MemoryAppearanceStore, ThemeService, UiSnackbar } from '@smart/ui';
import { API_FETCH } from '../api';
import { apiError, json } from '../../testing/auth-testing';
import { InstanceAppearanceSync } from './instance-appearance-sync';

const plum: InstanceAppearance = {
  ...DEFAULT_INSTANCE_APPEARANCE,
  colors: { ...DEFAULT_INSTANCE_APPEARANCE.colors, seed: '#6e4c7e' },
};
const sharp: InstanceAppearance = { ...DEFAULT_INSTANCE_APPEARANCE, shape: 'kantig' };

/** What the fake server knows; a PUT changes it. */
function setup(
  options: {
    server?: InstanceAppearance | null;
    store?: MemoryAppearanceStore;
    unreachable?: boolean;
    getAnswer?: () => Response;
  } = {},
) {
  let server = options.server ?? null;
  const { unreachable = false, getAnswer } = options;
  let failPut: (() => Response) | null = null;
  const puts: unknown[] = [];
  const signals: (AbortSignal | null | undefined)[] = [];

  const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    expect(String(input)).toBe('/api/v1/instance/appearance');
    if (unreachable) throw new TypeError('Failed to fetch');
    if (init?.method === 'PUT') {
      const body = JSON.parse(String(init.body)) as { appearance: InstanceAppearance | null };
      puts.push(body);
      if (failPut) return failPut();
      server = body.appearance;
      return json(body);
    }
    signals.push(init?.signal);
    return getAnswer ? getAnswer() : json({ appearance: server });
  });
  const store = options.store ?? new MemoryAppearanceStore();
  const show = vi.fn().mockResolvedValue('dismissed');

  TestBed.configureTestingModule({
    providers: [
      importProvidersFrom(
        TranslocoTestingModule.forRoot({
          langs: { de: {}, en: {} },
          translocoConfig: { availableLangs: ['de', 'en'], defaultLang: 'de' },
        }),
      ),
      { provide: API_FETCH, useValue: fetchFn },
      { provide: APPEARANCE_STORE, useValue: store },
      { provide: UiSnackbar, useValue: { show } },
    ],
  });
  const sync = TestBed.inject(InstanceAppearanceSync);
  return {
    sync,
    theme: TestBed.inject(ThemeService),
    store,
    show,
    puts,
    signals,
    failPutWith: (response: (() => Response) | null) => (failPut = response),
  };
}

async function pass(ms = 0) {
  TestBed.tick();
  await vi.advanceTimersByTimeAsync(ms);
  TestBed.tick();
}

describe('InstanceAppearanceSync', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    document.documentElement.removeAttribute('style');
  });

  describe('taking over the server value', () => {
    it('applies the value of the server at start, without sending it back', async () => {
      const harness = setup({ server: plum });
      await pass(1000);
      expect(harness.theme.instance()).toEqual(plum);
      expect(harness.store.instance).toEqual(plum);
      expect(harness.puts).toEqual([]);
    });

    it('asks with a time limit so the start never waits for a slow server', async () => {
      const harness = setup();
      await pass();
      expect(harness.signals[0]).toBeInstanceOf(AbortSignal);
    });

    it('drops the copy when the server has no value, so the build default applies again', async () => {
      const harness = setup({
        server: null,
        store: Object.assign(new MemoryAppearanceStore(), { instance: plum }),
      });
      await pass(1000);
      expect(harness.theme.instance()).toEqual(DEFAULT_INSTANCE_APPEARANCE);
      expect(harness.store.instance).toBeNull();
      expect(harness.puts).toEqual([]);
    });

    it('keeps the copy on the device and says nothing when the server cannot be reached', async () => {
      const store = Object.assign(new MemoryAppearanceStore(), { instance: sharp });
      const harness = setup({ store, unreachable: true });
      await pass(1000);
      expect(harness.theme.instance()).toEqual(sharp);
      expect(harness.store.instance).toEqual(sharp);
      expect(harness.show).not.toHaveBeenCalled();
    });

    it('keeps the copy when the server answers with an error or nonsense', async () => {
      const store = Object.assign(new MemoryAppearanceStore(), { instance: sharp });
      const harness = setup({ store, getAnswer: () => apiError('internal', 500) });
      await pass(1000);
      expect(harness.theme.instance()).toEqual(sharp);
      expect(harness.show).not.toHaveBeenCalled();
    });

    it('keeps the copy when the answer is not a valid appearance', async () => {
      const store = Object.assign(new MemoryAppearanceStore(), { instance: sharp });
      const harness = setup({ store, getAnswer: () => json({ appearance: { shape: 'rund' } }) });
      await pass(1000);
      expect(harness.theme.instance()).toEqual(sharp);
      expect(harness.show).not.toHaveBeenCalled();
    });
  });

  describe('changes by the platform admin', () => {
    it('sends one request 500 ms after the last of several quick changes', async () => {
      const harness = setup();
      await pass();
      harness.theme.setInstance(plum);
      await pass(200);
      harness.theme.setInstance(sharp);
      await pass(200);
      harness.theme.setInstance(plum);
      await pass(499);
      expect(harness.puts).toEqual([]);
      await pass(1);
      expect(harness.puts).toEqual([{ appearance: plum }]);
      await pass(2000);
      expect(harness.puts).toHaveLength(1);
    });

    it('sends a reset as null', async () => {
      const harness = setup({ server: plum });
      await pass();
      harness.theme.resetInstance();
      await pass(500);
      expect(harness.puts).toEqual([{ appearance: null }]);
      expect(harness.theme.instance()).toEqual(DEFAULT_INSTANCE_APPEARANCE);
    });

    it('shows the error and stays with the local value when saving fails', async () => {
      const harness = setup();
      await pass();
      harness.failPutWith(() => apiError('auth.forbidden', 403));
      harness.theme.setInstance(sharp);
      await pass(500);
      expect(harness.show).toHaveBeenCalledOnce();
      expect(harness.theme.instance()).toEqual(sharp);
    });

    it('does not let a late answer of the server overwrite a change made meanwhile', async () => {
      const harness = setup({ server: plum });
      harness.theme.setInstance(sharp);
      await pass(1000);
      expect(harness.theme.instance()).toEqual(sharp);
      expect(harness.puts).toEqual([{ appearance: sharp }]);
    });
  });
});
