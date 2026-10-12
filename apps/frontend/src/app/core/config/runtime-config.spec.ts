import { DEFAULT_INSTANCE_APPEARANCE, DEFAULT_RUNTIME_CONFIG } from '@smart/contracts';
import { loadRuntimeConfig } from './runtime-config';

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

describe('loadRuntimeConfig', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => undefined));
  afterEach(() => vi.restoreAllMocks());

  it('reads config.json without the HTTP cache', async () => {
    const fetchFn = vi.fn(() =>
      json({
        features: { instanceAppearanceEditor: true },
        instanceAppearance: DEFAULT_INSTANCE_APPEARANCE,
      }),
    );
    await expect(loadRuntimeConfig(fetchFn)).resolves.toEqual({
      features: { instanceAppearanceEditor: true },
      instanceAppearance: DEFAULT_INSTANCE_APPEARANCE,
    });
    expect(fetchFn).toHaveBeenCalledWith(
      'config.json',
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it('falls back to the defaults when config.json is missing', async () => {
    await expect(loadRuntimeConfig(() => json({}, 404))).resolves.toEqual(DEFAULT_RUNTIME_CONFIG);
  });

  it('falls back to the defaults when config.json is not JSON', async () => {
    const fetchFn = () => Promise.resolve(new Response('{"features":', { status: 200 }));
    await expect(loadRuntimeConfig(fetchFn)).resolves.toEqual(DEFAULT_RUNTIME_CONFIG);
  });

  it('falls back to the defaults when the network fails', async () => {
    await expect(
      loadRuntimeConfig(() => Promise.reject(new TypeError('offline'))),
    ).resolves.toEqual(DEFAULT_RUNTIME_CONFIG);
  });

  it('gives up after the timeout instead of delaying the app start', async () => {
    const hanging = (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) =>
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason)),
      );
    await expect(loadRuntimeConfig(hanging, 20)).resolves.toEqual(DEFAULT_RUNTIME_CONFIG);
  });
});
