import { Injectable, InjectionToken, inject } from '@angular/core';
import { apiErrorSchema } from '@smart/contracts';
import { ApiError } from './api-error';
import { UNAUTHORIZED_HANDLER } from './unauthorized-handler';

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** The browser's fetch; tests replace it. */
export const API_FETCH = new InjectionToken<FetchFn>('API_FETCH', {
  providedIn: 'root',
  factory: () => (input, init) => globalThis.fetch(input, init),
});

/** Prefix of the versioned API; every request path starts with `/api/`. */
export const API_BASE = '/api/v1';

export interface ApiRequestInit {
  readonly signal?: AbortSignal;
}

/**
 * Small JSON client for the same-origin API (cookies travel with every request). Failures become
 * `ApiError`: bodies that do not follow the API error format (a proxy page, a plain 404) and
 * network failures count as `internal`. A 401 `auth.required` also calls the unauthorized
 * handler; the request still fails so that callers can end their loading state.
 */
@Injectable({ providedIn: 'root' })
export class ApiClient {
  private readonly fetchFn = inject(API_FETCH);
  private readonly unauthorized = inject(UNAUTHORIZED_HANDLER);

  get<T>(path: string, init?: ApiRequestInit): Promise<T> {
    return this.request<T>('GET', path, undefined, init);
  }

  post<T>(path: string, body?: unknown, init?: ApiRequestInit): Promise<T> {
    return this.request<T>('POST', path, body, init);
  }

  put<T>(path: string, body?: unknown, init?: ApiRequestInit): Promise<T> {
    return this.request<T>('PUT', path, body, init);
  }

  private async request<T>(
    method: string,
    path: string,
    body: unknown,
    init: ApiRequestInit | undefined,
  ): Promise<T> {
    if (!path.startsWith('/api/')) throw new Error(`API paths start with /api/, got ${path}`);
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    let response: Response;
    try {
      response = await this.fetchFn(path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        credentials: 'same-origin',
        signal: init?.signal,
      });
    } catch (error) {
      // An abort is the caller's own doing, not an API failure.
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      throw new ApiError('internal', 0);
    }

    const text = await response.text().catch(() => '');
    if (!response.ok) throw this.toError(response.status, text);
    if (response.status === 204 || text === '') return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ApiError('internal', response.status);
    }
  }

  private toError(status: number, text: string): ApiError {
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(text);
    } catch {
      parsedBody = undefined;
    }
    const parsed = apiErrorSchema.safeParse(parsedBody);
    const error = parsed.success
      ? new ApiError(parsed.data.code, status, parsed.data.params)
      : new ApiError('internal', status);
    if (status === 401 && error.code === 'auth.required') this.unauthorized();
    return error;
  }
}
