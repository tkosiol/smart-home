import { Injectable, computed, effect, inject } from '@angular/core';
import { Router } from '@angular/router';
import type { HouseholdSummary } from '@smart/contracts';
import { UiFormatContext } from '@smart/ui/shell';
import { API_BASE, ApiClient } from '../api';
import { AuthService } from '../auth';

/**
 * The household the app shows (spec 4.4). It comes from the user's `me`, so it is there offline
 * too (from the device's copy). All formatting of dates follows its time zone.
 */
@Injectable({ providedIn: 'root' })
export class HouseholdContext {
  private readonly auth = inject(AuthService);
  private readonly api = inject(ApiClient);
  private readonly router = inject(Router);
  private readonly format = inject(UiFormatContext);
  private readonly browserTimeZone = this.format.timeZone();

  readonly households = computed<readonly HouseholdSummary[]>(
    () => this.auth.me()?.households ?? [],
  );
  /** The household the app shows; null while signed out or without any household. */
  readonly current = computed<HouseholdSummary | null>(() => {
    const households = this.households();
    const id = this.auth.me()?.currentHouseholdId;
    return households.find((household) => household.id === id) ?? households[0] ?? null;
  });

  constructor() {
    effect(() => this.format.timeZone.set(this.current()?.timezone ?? this.browserTimeZone));
  }

  /**
   * Switches on the server (`PUT /api/v1/me`), then adopts the answered `me`, unless the user
   * signed out (or another one signed in) while the server was asked.
   */
  async switchTo(householdId: string): Promise<void> {
    const userId = this.auth.me()?.id;
    const answered = await this.api.put<{ id?: unknown } | undefined>(`${API_BASE}/me`, {
      householdId,
    });
    if (this.auth.status() === 'signedOut' || this.auth.me()?.id !== userId) return;
    if (answered?.id !== userId) return;
    this.auth.updateMe(answered);
  }

  /**
   * After a 403/404 on a household path (membership or role changed): reload `me`, so `current`
   * falls back to a remaining household, and run the guards again for the page being shown.
   */
  async accessChanged(): Promise<void> {
    await this.auth.load();
    await this.router.navigateByUrl(this.router.url, { onSameUrlNavigation: 'reload' });
  }
}
