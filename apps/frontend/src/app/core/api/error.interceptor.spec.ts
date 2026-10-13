import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ApiError } from './api-error';
import { errorInterceptor } from './error.interceptor';
import { UNAUTHORIZED_HANDLER } from './unauthorized-handler';

function setup(handler = vi.fn()) {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(withInterceptors([errorInterceptor])),
      provideHttpClientTesting(),
      { provide: UNAUTHORIZED_HANDLER, useValue: handler },
    ],
  });
  return {
    handler,
    http: TestBed.inject(HttpClient),
    controller: TestBed.inject(HttpTestingController),
  };
}

async function failure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('The request did not fail');
}

describe('errorInterceptor', () => {
  afterEach(() => TestBed.inject(HttpTestingController).verify());

  it('turns the API error format into an ApiError with code, params and status', async () => {
    const { http, controller } = setup();
    const result = failure(
      new Promise((_, reject) => http.get('/api/x').subscribe({ error: reject })),
    );
    controller
      .expectOne('/api/x')
      .flush(
        { code: 'auth.rateLimited', params: { retryAfterSeconds: 30 }, traceId: 't1' },
        { status: 429, statusText: 'Too Many Requests' },
      );
    const error = await result;
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      code: 'auth.rateLimited',
      params: { retryAfterSeconds: 30 },
      status: 429,
    });
  });

  it('treats a response that does not match the format as internal', async () => {
    const { http, controller } = setup();
    const result = failure(
      new Promise((_, reject) => http.get('/api/x').subscribe({ error: reject })),
    );
    controller
      .expectOne('/api/x')
      .flush({ statusCode: 404, message: 'Not Found' }, { status: 404, statusText: 'Not Found' });
    expect(await result).toMatchObject({ code: 'internal', status: 404, params: undefined });
  });

  it('treats a network failure as internal with status 0', async () => {
    const { http, controller } = setup();
    const result = failure(
      new Promise((_, reject) => http.get('/api/x').subscribe({ error: reject })),
    );
    controller.expectOne('/api/x').error(new ProgressEvent('error'));
    expect(await result).toMatchObject({ code: 'internal', status: 0 });
  });

  it('calls the unauthorized handler on 401 auth.required and still fails the request', async () => {
    const { http, controller, handler } = setup();
    const result = failure(
      new Promise((_, reject) => http.get('/api/me').subscribe({ error: reject })),
    );
    controller
      .expectOne('/api/me')
      .flush({ code: 'auth.required', traceId: 't' }, { status: 401, statusText: 'Unauthorized' });
    expect(await result).toMatchObject({ code: 'auth.required', status: 401 });
    expect(handler).toHaveBeenCalledOnce();
  });

  it('does not call the handler for other errors', async () => {
    const { http, controller, handler } = setup();
    const result = failure(
      new Promise((_, reject) => http.get('/api/x').subscribe({ error: reject })),
    );
    controller
      .expectOne('/api/x')
      .flush(
        { code: 'auth.invalidCode', traceId: 't' },
        { status: 400, statusText: 'Bad Request' },
      );
    await result;
    expect(handler).not.toHaveBeenCalled();
  });

  it('leaves requests outside /api/ alone', async () => {
    const { http, controller, handler } = setup();
    const result = failure(
      new Promise((_, reject) => http.get('/config.json').subscribe({ error: reject })),
    );
    controller
      .expectOne('/config.json')
      .flush({ code: 'auth.required', traceId: 't' }, { status: 401, statusText: 'Unauthorized' });
    expect(await result).not.toBeInstanceOf(ApiError);
    expect(handler).not.toHaveBeenCalled();
  });

  it('does nothing on 401 by default', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([errorInterceptor])),
        provideHttpClientTesting(),
      ],
    });
    const http = TestBed.inject(HttpClient);
    const result = failure(
      new Promise((_, reject) => http.get('/api/me').subscribe({ error: reject })),
    );
    TestBed.inject(HttpTestingController)
      .expectOne('/api/me')
      .flush({ code: 'auth.required', traceId: 't' }, { status: 401, statusText: 'Unauthorized' });
    expect(await result).toBeInstanceOf(ApiError);
  });
});
