import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { UNAUTHORIZED_HANDLER, API_FETCH } from '../api';
import { AuthService, type AuthStatus } from '../auth';
import { HouseholdContext } from '../household';
import { LIVE_RETRY, LiveService } from './live.service';

interface FakeStream {
  url: string;
  init: RequestInit;
  send(text: string): void;
  end(): void;
}

describe('LiveService', () => {
  const status = signal<AuthStatus>('signedIn');
  const household = signal<{ id: string } | null>({ id: 'h1' });
  const unauthorized = vi.fn();
  let respond: (stream: FakeStream) => Response | Promise<Response | undefined> | undefined;
  let streams: FakeStream[];
  let calls: { url: string; init: RequestInit }[];
  let visibility: ReturnType<typeof vi.spyOn>;
  const encoder = new TextEncoder();

  function streamResponse(): { response: Response; stream: Pick<FakeStream, 'send' | 'end'> } {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start: (c) => (controller = c) });
    return {
      response: new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }),
      stream: {
        send: (text) => controller.enqueue(encoder.encode(text)),
        end: () => controller.close(),
      },
    };
  }

  function setup(): LiveService {
    return TestBed.inject(LiveService);
  }
  async function settle(ms = 0): Promise<void> {
    TestBed.tick();
    await vi.advanceTimersByTimeAsync(ms);
    TestBed.tick();
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    status.set('signedIn');
    household.set({ id: 'h1' });
    unauthorized.mockReset();
    streams = [];
    calls = [];
    respond = () => undefined;
    visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { status } },
        { provide: HouseholdContext, useValue: { current: household } },
        { provide: UNAUTHORIZED_HANDLER, useValue: unauthorized },
        {
          provide: API_FETCH,
          useValue: async (url: string, init: RequestInit) => {
            calls.push({ url, init });
            const { response, stream } = streamResponse();
            const fake: FakeStream = { url, init, ...stream };
            const custom = await respond(fake);
            if (custom) return custom;
            streams.push(fake);
            return response;
          },
        },
      ],
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('does not connect without a subscriber', async () => {
    setup();
    await settle(5000);
    expect(calls).toHaveLength(0);
  });

  it('connects with a subscriber, using the stream request headers', async () => {
    const live = setup();
    live.subscribe({});
    await settle();
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/api/v1/households/h1/events');
    expect(calls[0].init.credentials).toBe('same-origin');
    expect(calls[0].init.headers).toEqual({
      Accept: 'text/event-stream',
      'ngsw-bypass': 'true',
    });
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  it('does not connect while signed out or without a household', async () => {
    status.set('signedOut');
    const live = setup();
    live.subscribe({});
    await settle();
    expect(calls).toHaveLength(0);
    status.set('signedIn');
    household.set(null);
    await settle();
    expect(calls).toHaveLength(0);
    household.set({ id: 'h1' });
    await settle();
    expect(calls).toHaveLength(1);
  });

  it('calls resync of subscribers on connect, not for later ones', async () => {
    const live = setup();
    const early = vi.fn();
    const late = vi.fn();
    live.subscribe({ resync: early });
    await settle();
    expect(early).toHaveBeenCalledOnce();
    live.subscribe({ resync: late });
    await settle(100);
    expect(late).not.toHaveBeenCalled();
  });

  it('gives resync to a subscriber that joined while connecting', async () => {
    let release!: () => void;
    respond = async () => {
      await new Promise<void>((resolve) => (release = resolve));
      return undefined;
    };
    const live = setup();
    live.subscribe({});
    await settle();
    const joined = vi.fn();
    live.subscribe({ resync: joined });
    release();
    await settle();
    expect(joined).toHaveBeenCalledOnce();
  });

  it('dispatches events to the handlers and ignores the rest', async () => {
    const live = setup();
    const state = vi.fn();
    const status2 = vi.fn();
    live.subscribe({ 'device.state': state });
    live.subscribe({ 'gateway.status': status2 });
    await settle();
    streams[0].send(': connected\n\nevent: device.state\ndata: {"id":"d1"}\n\n');
    streams[0].send('event: unknown.type\ndata: {}\n\n');
    streams[0].send('event: device.state\ndata: {broken\n\n');
    streams[0].send('event: hardware.removed\ndata: {"id":"x"}\n\n');
    await settle();
    expect(state).toHaveBeenCalledExactlyOnceWith({ id: 'd1' });
    expect(status2).not.toHaveBeenCalled();
  });

  it('keeps going when a handler throws', async () => {
    const live = setup();
    const second = vi.fn();
    live.subscribe({
      resync: () => {
        throw new Error('x');
      },
      'device.state': () => {
        throw new Error('y');
      },
    });
    live.subscribe({ resync: second, 'device.state': second });
    await settle();
    streams[0].send('event: device.state\ndata: {"id":"d1"}\n\n');
    streams[0].send('event: device.state\ndata: {"id":"d2"}\n\n');
    await settle();
    expect(second).toHaveBeenCalledTimes(3);
    expect(calls).toHaveLength(1);
  });

  it('stops delivering after unsubscribe and closes with the last subscriber', async () => {
    const live = setup();
    const handler = vi.fn();
    const off = live.subscribe({ 'device.state': handler });
    await settle();
    const signal0 = calls[0].init.signal!;
    off();
    off();
    await settle();
    expect(signal0.aborted).toBe(true);
    await settle(60_000);
    expect(calls).toHaveLength(1);
  });

  it('closes while the tab is hidden and reconnects with resync when visible', async () => {
    const live = setup();
    const resync = vi.fn();
    live.subscribe({ resync });
    await settle();
    visibility.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    await settle(60_000);
    expect(calls[0].init.signal!.aborted).toBe(true);
    expect(calls).toHaveLength(1);
    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(calls).toHaveLength(2);
    expect(resync).toHaveBeenCalledTimes(2);
  });

  it('switches to the new household without two connections', async () => {
    const live = setup();
    live.subscribe({});
    await settle();
    household.set({ id: 'h2' });
    await settle();
    expect(calls).toHaveLength(2);
    expect(calls[0].init.signal!.aborted).toBe(true);
    expect(calls[1].url).toBe('/api/v1/households/h2/events');
    expect(calls[1].init.signal!.aborted).toBe(false);
  });

  it('retries after 1, 2, 4 ... up to 30 seconds', async () => {
    respond = () => new Response('', { status: 503 });
    const live = setup();
    live.subscribe({});
    await settle();
    expect(calls).toHaveLength(1);
    const waits = [1000, 2000, 4000, 8000, 16_000, 30_000, 30_000];
    for (const [index, wait] of waits.entries()) {
      await settle(wait - 1);
      expect(calls).toHaveLength(index + 1);
      await settle(1);
      expect(calls).toHaveLength(index + 2);
    }
    expect(LIVE_RETRY).toEqual({ firstMs: 1000, maxMs: 30_000, jitter: 0.2 });
  });

  it('spreads the wait by the jitter', async () => {
    respond = () => new Response('', { status: 500 });
    const random = vi.spyOn(Math, 'random').mockReturnValue(0);
    const live = setup();
    live.subscribe({});
    await settle();
    await settle(799);
    expect(calls).toHaveLength(1);
    await settle(1);
    expect(calls).toHaveLength(2);
    random.mockReturnValue(1);
    await settle(1599);
    expect(calls).toHaveLength(2);
    await settle(1);
    expect(calls).toHaveLength(3);
    await settle(2400 - 1);
    expect(calls).toHaveLength(3);
  });

  it('retries on network errors and on a wrong content type', async () => {
    let attempt = 0;
    respond = () => {
      attempt++;
      if (attempt === 1) throw new TypeError('offline');
      if (attempt === 2)
        return new Response('<html>', { headers: { 'Content-Type': 'text/html' } });
      return undefined;
    };
    const live = setup();
    live.subscribe({});
    await settle();
    await settle(1000);
    await settle(2000);
    expect(calls).toHaveLength(3);
    expect(streams).toHaveLength(1);
  });

  it('starts again at one second after a success', async () => {
    let fail = true;
    respond = () => (fail ? new Response('', { status: 502 }) : undefined);
    const live = setup();
    live.subscribe({});
    await settle();
    await settle(1000);
    await settle(2000);
    expect(calls).toHaveLength(3);
    fail = false;
    await settle(4000);
    expect(calls).toHaveLength(4);
    streams[0].end();
    await settle();
    await settle(999);
    expect(calls).toHaveLength(4);
    await settle(1);
    expect(calls).toHaveLength(5);
  });

  it('reconnects and resyncs when the stream ends, with one connection', async () => {
    const live = setup();
    const resync = vi.fn();
    live.subscribe({ resync });
    await settle();
    streams[0].end();
    await settle();
    expect(calls).toHaveLength(1);
    await settle(1000);
    expect(calls).toHaveLength(2);
    expect(resync).toHaveBeenCalledTimes(2);
    await settle(60_000);
    expect(calls).toHaveLength(2);
  });

  it('hands a 401 to the handler once and stops until the sign-in changes', async () => {
    respond = () =>
      new Response(JSON.stringify({ code: 'auth.required', params: {}, traceId: 't' }), {
        status: 401,
      });
    const live = setup();
    live.subscribe({});
    await settle();
    await settle(120_000);
    expect(calls).toHaveLength(1);
    expect(unauthorized).toHaveBeenCalledOnce();
    status.set('signedOut');
    await settle();
    status.set('signedIn');
    respond = () => undefined;
    await settle();
    expect(calls).toHaveLength(2);
    expect(unauthorized).toHaveBeenCalledOnce();
  });

  it('does not lift a block when the tab comes back', async () => {
    respond = () => new Response('', { status: 403 });
    const live = setup();
    live.subscribe({});
    await settle();
    visibility.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await settle(60_000);
    expect(calls).toHaveLength(1);
  });

  it.each([403, 404])('stops after %i until the household changes', async (code) => {
    respond = () => new Response('', { status: code });
    const live = setup();
    live.subscribe({});
    await settle();
    await settle(120_000);
    expect(calls).toHaveLength(1);
    expect(unauthorized).not.toHaveBeenCalled();
    respond = () => undefined;
    household.set({ id: 'h2' });
    await settle();
    expect(calls).toHaveLength(2);
  });

  it('cancels a pending retry when the last subscriber leaves', async () => {
    respond = () => new Response('', { status: 503 });
    const live = setup();
    const off = live.subscribe({});
    await settle();
    off();
    await settle(60_000);
    expect(calls).toHaveLength(1);
  });
});
