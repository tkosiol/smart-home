import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, effect, inject, signal, untracked } from '@angular/core';
import type { LiveEventData, LiveEventType } from '@smart/contracts';
import { API_BASE, API_FETCH, UNAUTHORIZED_HANDLER } from '../api';
import { AuthService } from '../auth';
import { HouseholdContext } from '../household';
import { SseParser } from './sse-parser';

export type LiveHandlers = { [T in LiveEventType]?: (data: LiveEventData<T>) => void } & {
  /** After every connect while subscribed: load the shown state again (REST). */
  resync?: () => void;
};

/** Reconnect wait: doubles from `firstMs` up to `maxMs`, spread by ±`jitter`. */
export const LIVE_RETRY = { firstMs: 1000, maxMs: 30_000, jitter: 0.2 } as const;

/** No bytes (the server pings every 25 s) for this long: the connection is taken as dead. */
export const LIVE_IDLE_MS = 60_000;

/** Runs a handler; one that throws must not disturb the others or the stream. */
function safely(call: () => void): void {
  try {
    call();
  } catch (error) {
    console.error('Live handler failed', error);
  }
}

/**
 * One server-sent-events stream per signed-in (or offline) household while something subscribes and the tab is
 * visible. Dropped streams are opened again with a backoff, and every connect tells the
 * subscribers present to load their state again (`resync`): events missed meanwhile are not
 * replayed. A 401 goes to the unauthorized handler, a 403/404 stops the stream; both stay stopped
 * until the sign-in state or the household changes.
 */
@Injectable({ providedIn: 'root' })
export class LiveService {
  private readonly auth = inject(AuthService);
  private readonly household = inject(HouseholdContext);
  private readonly fetchFn = inject(API_FETCH);
  private readonly unauthorized = inject(UNAUTHORIZED_HANDLER);
  private readonly document = inject(DOCUMENT);
  private readonly subscribers = signal<readonly LiveHandlers[]>([]);
  private readonly visible = signal(this.document.visibilityState === 'visible');

  /** The household the current connection (or pending retry) is for. */
  private target: string | undefined;
  private abort: AbortController | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private failures = 0;
  /** The (status, household) pair a 401/403/404 happened for. */
  private blocked: string | undefined;

  constructor() {
    const onVisibility = () => this.visible.set(this.document.visibilityState === 'visible');
    this.document.addEventListener('visibilitychange', onVisibility);
    inject(DestroyRef).onDestroy(() => {
      this.document.removeEventListener('visibilitychange', onVisibility);
      this.close();
    });
    effect(() => {
      const status = this.auth.status();
      const householdId = this.household.current()?.id;
      const wanted =
        (status === 'signedIn' || status === 'offline') &&
        householdId &&
        this.subscribers().length > 0 &&
        this.visible();
      untracked(() => this.reconcile(`${status}|${householdId}`, wanted ? householdId : undefined));
    });
  }

  /** Returns the function that ends the subscription. */
  subscribe(handlers: LiveHandlers): () => void {
    const entry = { ...handlers };
    this.subscribers.update((list) => [...list, entry]);
    return () => this.subscribers.update((list) => list.filter((item) => item !== entry));
  }

  private reconcile(pair: string, wanted: string | undefined): void {
    if (this.blocked !== pair) this.blocked = undefined;
    if (wanted !== undefined && this.blocked === pair) wanted = undefined;
    if (wanted === this.target) return;
    // A new target starts with the short wait again.
    this.failures = 0;
    this.close();
    this.target = wanted;
    if (wanted !== undefined) void this.connect(wanted, pair);
  }

  private close(): void {
    this.abort?.abort();
    this.abort = undefined;
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.target = undefined;
  }

  private async connect(householdId: string, pair: string): Promise<void> {
    const abort = (this.abort = new AbortController());
    try {
      const response = await this.fetchFn(`${API_BASE}/households/${householdId}/events`, {
        credentials: 'same-origin',
        headers: { Accept: 'text/event-stream', 'ngsw-bypass': 'true' },
        signal: abort.signal,
      });
      if (abort.signal.aborted) return;
      if (response.status === 401 || response.status === 403 || response.status === 404) {
        if (response.status === 401 && !(await this.isAuthRequired(response))) {
          return this.retry(householdId, pair, abort);
        }
        this.blocked = pair;
        if (response.status === 401) this.unauthorized();
        return;
      }
      const type = response.headers.get('Content-Type') ?? '';
      if (!response.ok || !response.body || !type.startsWith('text/event-stream')) {
        return this.retry(householdId, pair, abort);
      }
      this.failures = 0;
      // Opened although the app thinks the server is unreachable: ask for the session again.
      if (this.auth.status() === 'offline') void this.auth.load();
      for (const subscriber of [...this.subscribers()]) {
        if (subscriber.resync) safely(subscriber.resync);
      }
      await this.read(response.body.getReader(), abort.signal);
    } catch {
      // Network failure or abort: an abort is our own doing, anything else is retried below.
    }
    if (!abort.signal.aborted) this.retry(householdId, pair, abort);
  }

  private async isAuthRequired(response: Response): Promise<boolean> {
    const body: unknown = await response.json().catch(() => undefined);
    return (body as { code?: unknown } | undefined)?.code === 'auth.required';
  }

  private async read(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    signal: AbortSignal,
  ): Promise<void> {
    const decoder = new TextDecoder();
    const parser = new SseParser();
    const cancel = () => void reader.cancel().catch(() => undefined);
    signal.addEventListener('abort', cancel);
    // Pings count as bytes; a half-open connection never delivers any. Cancelling the reader ends
    // the read without an abort, so the caller retries and resyncs.
    let idle: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      clearTimeout(idle);
      idle = setTimeout(cancel, LIVE_IDLE_MS);
    };
    arm();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done || signal.aborted) return;
        arm();
        for (const message of parser.push(decoder.decode(value, { stream: true }))) {
          this.dispatch(message.event, message.data);
        }
      }
    } finally {
      clearTimeout(idle);
      signal.removeEventListener('abort', cancel);
    }
  }

  private dispatch(event: string, raw: string): void {
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    for (const subscriber of [...this.subscribers()]) {
      const handler = (subscriber as Record<string, ((data: unknown) => void) | undefined>)[event];
      if (event !== 'resync' && typeof handler === 'function') safely(() => handler(data));
    }
  }

  private retry(householdId: string, pair: string, abort: AbortController): void {
    if (abort.signal.aborted) return;
    const { firstMs, maxMs, jitter } = LIVE_RETRY;
    const base = Math.min(maxMs, firstMs * 2 ** this.failures);
    this.failures++;
    const wait = base * (1 + jitter * (2 * Math.random() - 1));
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      void this.connect(householdId, pair);
    }, wait);
  }
}

/** Subscribes for the injection context's lifetime. */
export function injectLive(handlers: LiveHandlers): void {
  const off = inject(LiveService).subscribe(handlers);
  inject(DestroyRef).onDestroy(off);
}
