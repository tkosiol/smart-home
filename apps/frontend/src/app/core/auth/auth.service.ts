import { DOCUMENT, DestroyRef, Injectable, effect, inject, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { meSchema, type Me } from '@smart/contracts';
import { API_BASE, ApiClient, ApiError } from '../api';
import { OnlineStatus } from '../pwa';
import { ME_CACHE } from './me-cache';

/** How long the start waits for `GET /me` before it falls back to the copy on the device. */
export const START_LOAD_TIMEOUT_MS = 5000;

/** `offline`: signed in according to the device's copy, the server could not be asked. */
export type AuthStatus = 'unknown' | 'signedIn' | 'signedOut' | 'offline';

/**
 * Who is signed in. The user comes from `GET /api/v1/me`; a copy without secrets on the device
 * lets the app start without a connection (spec 4.3). Failures other than 401 (no network, a
 * server error, an answer that is no user) count as "server unreachable".
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(ApiClient);
  private readonly router = inject(Router);
  private readonly cache = inject(ME_CACHE);
  private readonly online = inject(OnlineStatus).online;
  private readonly document = inject(DOCUMENT);

  private readonly meState = signal<Me | null>(null);
  private readonly statusState = signal<AuthStatus>('unknown');
  private readonly connectionLostState = signal(false);
  private first?: Promise<void>;
  private running?: Promise<void>;

  readonly me = this.meState.asReadonly();
  readonly status = this.statusState.asReadonly();
  /** The server could not be reached and there is no copy to start from: the sign-in page says so. */
  readonly connectionLost = this.connectionLostState.asReadonly();

  constructor() {
    let wasOnline = this.online();
    effect(() => {
      const online = this.online();
      const returned = online && !wasOnline;
      wasOnline = online;
      if (returned) {
        untracked(() => {
          if (this.status() === 'offline' || this.connectionLost()) void this.load();
        });
      }
    });
    // A server error while the browser is online raises no `online` event: ask again when the
    // user comes back to the page, so "offline" does not stick.
    const onVisible = () => {
      if (this.document.visibilityState !== 'visible') return;
      if (this.status() === 'offline' || this.connectionLost()) void this.load();
    };
    this.document.addEventListener('visibilitychange', onVisible);
    inject(DestroyRef).onDestroy(() =>
      this.document.removeEventListener('visibilitychange', onVisible),
    );
  }

  /** The first `load()`, started on demand; the route guard and the sign-in page wait for it. */
  ready(): Promise<void> {
    return (this.first ??= this.load());
  }

  /** Asks the server who is signed in. Never rejects; the outcome is in `status`. */
  load(): Promise<void> {
    return (this.running ??= this.fetchMe().finally(() => (this.running = undefined)));
  }

  /** A request failed with 401 `auth.required`: the session is over. */
  handleUnauthorized(): void {
    // Before the first answer the guard decides where to go; signed out, the user is there already.
    if (this.status() !== 'signedIn' && this.status() !== 'offline') return;
    const target = this.router.url;
    this.signOutLocally();
    this.cache.clearThemeBoot();
    void this.router.navigate(['/anmelden'], {
      queryParams: target === '/' ? undefined : { ziel: target },
    });
  }

  /** Takes over a user the server just returned (e.g. after saving preferences); refuses anything else. */
  updateMe(raw: unknown): void {
    this.setSignedIn(this.parseMe(raw));
  }

  /** Always answers 204: whether the address belongs to an account is not revealed. */
  async requestCode(email: string): Promise<void> {
    await this.api.post(`${API_BASE}/auth/email-code`, { email });
  }

  async verifyCode(email: string, code: string): Promise<void> {
    this.setSignedIn(
      this.parseMe(await this.api.post(`${API_BASE}/auth/email-code/verify`, { email, code })),
    );
  }

  /** Ends the session on the server, then on the device. A failing server leaves the user signed in. */
  async logout(): Promise<void> {
    try {
      await this.api.post(`${API_BASE}/auth/logout`);
    } catch (error) {
      // 401: the session was over anyway.
      if (!(error instanceof ApiError && error.status === 401)) throw error;
    }
    this.signOutLocally();
    this.cache.clearThemeBoot();
    await this.router.navigateByUrl('/anmelden');
  }

  private async fetchMe(): Promise<void> {
    try {
      this.setSignedIn(
        this.parseMe(
          // A hanging server fails like a lost connection (`TimeoutError` becomes `internal`), so
          // the start falls back to the copy on the device instead of waiting for it.
          await this.api.get(`${API_BASE}/me`, {
            signal: AbortSignal.timeout(START_LOAD_TIMEOUT_MS),
          }),
        ),
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        this.signOutLocally();
        return;
      }
      this.serverUnreachable();
    }
  }

  private parseMe(raw: unknown): Me {
    const parsed = meSchema.safeParse(raw);
    if (!parsed.success) throw new ApiError('internal', 200);
    return parsed.data;
  }

  private setSignedIn(me: Me): void {
    this.meState.set(me);
    this.statusState.set('signedIn');
    this.connectionLostState.set(false);
    this.cache.save(me);
  }

  private signOutLocally(): void {
    this.cache.clear();
    this.meState.set(null);
    this.statusState.set('signedOut');
    this.connectionLostState.set(false);
  }

  private serverUnreachable(): void {
    const copy = this.cache.load();
    this.meState.set(copy);
    this.statusState.set(copy ? 'offline' : 'signedOut');
    this.connectionLostState.set(copy === null);
  }
}
