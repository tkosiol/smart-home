import { DestroyRef, Injectable, effect, inject, untracked } from '@angular/core';
import { meSchema, type Me, type PreferencesUpdate } from '@smart/contracts';
import { ThemeService } from '@smart/ui';
import { API_BASE, ApiClient, ApiError, injectShowApiError } from '../api';
import { LanguageService } from '../i18n';
import { OnlineStatus } from '../pwa';
import { AuthService } from './auth.service';
import { PENDING_PREFERENCES, type PendingPreferences } from './pending-preferences';

/** A burst of changes (a color picker, a slider) becomes one request. */
const DEBOUNCE_MS = 500;

/**
 * Keeps theme and language on the account (spec 4.5). The user from the server is adopted
 * without sending it back. Changes the user makes are sent after a pause; while the server cannot
 * be reached they wait on the device, and the next successful load sends them before it takes
 * over the server's values (the last change wins).
 */
@Injectable({ providedIn: 'root' })
export class PreferencesSync {
  private readonly auth = inject(AuthService);
  private readonly api = inject(ApiClient);
  private readonly theme = inject(ThemeService);
  private readonly language = inject(LanguageService);
  private readonly online = inject(OnlineStatus).online;
  private readonly store = inject(PENDING_PREFERENCES);
  private readonly showError = injectShowApiError();

  private pending: PendingPreferences | null = this.store.load();
  /** Counts the user's changes, so an answer can tell whether the user changed more meanwhile. */
  private revision = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private sending = false;
  private adopted: Me | null = null;

  constructor() {
    const stopTheme = this.theme.onPersonalChange((appearance) => this.record({ appearance }));
    const stopLanguage = this.language.onChange((locale) => this.record({ locale }));
    inject(DestroyRef).onDestroy(() => {
      stopTheme();
      stopLanguage();
      clearTimeout(this.timer);
    });
    effect(() => {
      const me = this.auth.me();
      const status = this.auth.status();
      this.online();
      untracked(() => this.reconcile(me, status));
    });
  }

  private reconcile(me: Me | null, status: ReturnType<AuthService['status']>): void {
    if (status === 'signedOut') {
      // Without a connection and without a copy nobody is known, but the changes may be theirs.
      if (!this.auth.connectionLost()) this.discard();
      return;
    }
    if (!me) return;
    if (this.pending && this.pending.userId !== me.id) this.discard();
    if (this.pending) this.sendWhenPossible();
    else if (me !== this.adopted) {
      this.adopted = me;
      this.theme.adoptPersonal(me.appearance);
      this.language.adopt(me.locale);
    }
  }

  private record(change: PreferencesUpdate): void {
    const status = this.auth.status();
    const userId = this.auth.me()?.id;
    if ((status !== 'signedIn' && status !== 'offline') || !userId) return;
    this.pending = {
      ...(this.pending?.userId === userId ? this.pending : null),
      ...change,
      userId,
    };
    this.store.save(this.pending);
    this.revision++;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.sendWhenPossible();
    }, DEBOUNCE_MS);
  }

  /** Only a user the server confirmed this session and a working connection qualify. */
  private sendWhenPossible(): void {
    if (this.timer || this.sending || !this.pending) return;
    if (this.auth.status() !== 'signedIn' || !this.online()) return;
    // The session may belong to someone else than the one who made the change.
    if (this.auth.me()?.id !== this.pending.userId) return this.discard();
    const { userId, ...body } = this.pending;
    void this.send(userId, body);
  }

  private async send(userId: string, body: PreferencesUpdate): Promise<void> {
    const revision = this.revision;
    this.sending = true;
    try {
      const answer = await this.api.put(`${API_BASE}/me/preferences`, body);
      // The session may have ended or another user may have signed in meanwhile; the answer
      // must neither sign anyone in again nor replace the user.
      if (this.auth.status() === 'signedOut') return;
      const me = meSchema.parse(answer);
      if (me.id !== userId || me.id !== this.auth.me()?.id) return;
      if (revision === this.revision) this.clearPending();
      this.auth.updateMe(me);
    } catch (error) {
      // The server refused the change itself: sending it again would never succeed and would
      // keep the user's values from the server out for good. Waiting requests (408, 425, 429)
      // and failures of the connection stay pending.
      const refused = error instanceof ApiError && (error.status === 400 || error.status === 422);
      if (refused && revision === this.revision) this.clearPending();
      this.showError(error);
    } finally {
      this.sending = false;
      // More changes came in while the request ran and their timer has gone off already.
      if (revision !== this.revision) this.sendWhenPossible();
    }
  }

  private discard(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.revision++;
    this.clearPending();
  }

  private clearPending(): void {
    this.pending = null;
    this.store.clear();
  }
}
