import { TestBed } from '@angular/core/testing';
import { API_BASE, API_FETCH, ApiClient } from './api-client';
import { ApiError } from './api-error';
import { UNAUTHORIZED_HANDLER } from './unauthorized-handler';

function setup(respond: () => Response | Promise<Response>) {
  const fetchFn = vi.fn(async () => respond());
  const handler = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      { provide: API_FETCH, useValue: fetchFn },
      { provide: UNAUTHORIZED_HANDLER, useValue: handler },
    ],
  });
  return { fetchFn, handler, api: TestBed.inject(ApiClient) };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function failure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('The request did not fail');
}

describe('ApiClient', () => {
  it('reads JSON and sends same-origin cookies without a body type for GET', async () => {
    const { api, fetchFn } = setup(() => json({ id: 1 }));
    await expect(api.get(`${API_BASE}/me`)).resolves.toEqual({ id: 1 });
    expect(fetchFn).toHaveBeenCalledWith(
      '/api/v1/me',
      expect.objectContaining({
        method: 'GET',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
        body: undefined,
      }),
    );
  });

  it('sends POST and PUT bodies as JSON', async () => {
    const { api, fetchFn } = setup(() => json({ ok: true }));
    await api.post('/api/v1/a', { x: 1 });
    await api.put('/api/v1/b', { y: 2 });
    expect(fetchFn).toHaveBeenNthCalledWith(
      1,
      '/api/v1/a',
      expect.objectContaining({
        method: 'POST',
        body: '{"x":1}',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      }),
    );
    expect(fetchFn).toHaveBeenNthCalledWith(
      2,
      '/api/v1/b',
      expect.objectContaining({ method: 'PUT', body: '{"y":2}' }),
    );
  });

  it('sends no content type for a POST without a body and passes the abort signal on', async () => {
    const { api, fetchFn } = setup(() => json({}));
    const controller = new AbortController();
    await api.post('/api/v1/logout', undefined, { signal: controller.signal });
    expect(fetchFn).toHaveBeenCalledWith(
      '/api/v1/logout',
      expect.objectContaining({
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      }),
    );
  });

  it('resolves undefined for 204 and for an empty body', async () => {
    expect(await setup(() => new Response(null, { status: 204 })).api.post('/api/v1/x')).toBe(
      undefined,
    );
    TestBed.resetTestingModule();
    expect(await setup(() => new Response('', { status: 200 })).api.get('/api/v1/x')).toBe(
      undefined,
    );
  });

  it('turns the API error format into an ApiError with code, params and status', async () => {
    const { api } = setup(() =>
      json({ code: 'auth.rateLimited', params: { retryAfterSeconds: 30 }, traceId: 't1' }, 429),
    );
    const error = await failure(api.get('/api/v1/x'));
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      code: 'auth.rateLimited',
      params: { retryAfterSeconds: 30 },
      status: 429,
    });
  });

  it('treats a body that does not match the format as internal', async () => {
    const { api } = setup(() => json({ statusCode: 404, message: 'Not Found' }, 404));
    expect(await failure(api.get('/api/v1/x'))).toMatchObject({
      code: 'internal',
      status: 404,
      params: undefined,
    });
  });

  it('treats a body that is no JSON as internal', async () => {
    const { api } = setup(() => new Response('<html>', { status: 502 }));
    expect(await failure(api.get('/api/v1/x'))).toMatchObject({ code: 'internal', status: 502 });
  });

  it('treats a network failure as internal with status 0', async () => {
    const { api } = setup(() => Promise.reject(new TypeError('Failed to fetch')));
    expect(await failure(api.get('/api/v1/x'))).toMatchObject({ code: 'internal', status: 0 });
  });

  it('lets an abort through unchanged', async () => {
    const abort = new DOMException('aborted', 'AbortError');
    const { api } = setup(() => Promise.reject(abort));
    expect(await failure(api.get('/api/v1/x'))).toBe(abort);
  });

  it('calls the unauthorized handler on 401 auth.required and still throws', async () => {
    const { api, handler } = setup(() => json({ code: 'auth.required', traceId: 't' }, 401));
    expect(await failure(api.get('/api/v1/me'))).toMatchObject({
      code: 'auth.required',
      status: 401,
    });
    expect(handler).toHaveBeenCalledOnce();
  });

  it('does not call the handler for other errors', async () => {
    const { api, handler } = setup(() => json({ code: 'auth.invalidCode', traceId: 't' }, 400));
    await failure(api.post('/api/v1/x'));
    expect(handler).not.toHaveBeenCalled();
  });

  it('does nothing on 401 by default', async () => {
    const fetchFn = vi.fn(async () => json({ code: 'auth.required', traceId: 't' }, 401));
    TestBed.configureTestingModule({ providers: [{ provide: API_FETCH, useValue: fetchFn }] });
    expect(await failure(TestBed.inject(ApiClient).get('/api/v1/me'))).toBeInstanceOf(ApiError);
  });

  it('rejects paths outside /api/ without sending anything', async () => {
    const { api, fetchFn } = setup(() => json({}));
    await expect(api.get('/config.json')).rejects.toThrow('/api/');
    await expect(api.get('api/v1/me')).rejects.toThrow('/api/');
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
