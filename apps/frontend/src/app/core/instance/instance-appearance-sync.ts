import { DestroyRef, Injectable, inject } from '@angular/core';
import { instanceAppearanceUpdateSchema, type InstanceAppearance } from '@smart/contracts';
import { ThemeService } from '@smart/ui';
import { API_BASE, ApiClient, injectShowApiError } from '../api';

/** How long the start waits for the server before the copy on the device stays in charge. */
const LOAD_TIMEOUT_MS = 5000;
/** A burst of changes (a color picker, a slider) becomes one request. */
const DEBOUNCE_MS = 500;

const PATH = `${API_BASE}/instance/appearance`;

/**
 * Keeps the instance appearance on the server (spec 3.8). At start it takes over the server's
 * value (`null`: none stored, so config.json or the build default applies); when the server cannot
 * be reached the copy on the device stays and nothing is reported. Changes the platform admin
 * makes are sent after a pause; if that fails the page keeps the local value and shows the error.
 * What came from the server is never sent back.
 */
@Injectable({ providedIn: 'root' })
export class InstanceAppearanceSync {
  private readonly api = inject(ApiClient);
  private readonly theme = inject(ThemeService);
  private readonly showError = injectShowApiError();

  /** The newest change not sent yet (`null` is a reset). */
  private pending: { readonly value: InstanceAppearance | null } | null = null;
  /** Once the admin has changed something, an older answer of the server must not undo it. */
  private edited = false;
  private timer?: ReturnType<typeof setTimeout>;
  private sending = false;

  constructor() {
    const stop = this.theme.onInstanceChange((value) => this.record(value));
    inject(DestroyRef).onDestroy(() => {
      stop();
      clearTimeout(this.timer);
    });
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const answer = await this.api.get(PATH, { signal: AbortSignal.timeout(LOAD_TIMEOUT_MS) });
      const { appearance } = instanceAppearanceUpdateSchema.parse(answer);
      if (!this.edited) this.theme.adoptInstance(appearance);
    } catch {
      // Offline, slow or unusable answer: the copy on the device is good enough.
    }
  }

  private record(value: InstanceAppearance | null): void {
    this.edited = true;
    this.pending = { value };
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, DEBOUNCE_MS);
  }

  private async flush(): Promise<void> {
    if (this.sending || !this.pending) return;
    const { value } = this.pending;
    this.pending = null;
    this.sending = true;
    try {
      await this.api.put(PATH, { appearance: value });
    } catch (error) {
      this.showError(error);
    } finally {
      this.sending = false;
      // Another change came in while the request ran and its timer has gone off already.
      if (this.pending && !this.timer) void this.flush();
    }
  }
}
