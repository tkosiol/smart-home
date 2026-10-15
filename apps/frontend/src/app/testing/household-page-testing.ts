import { TestBed } from '@angular/core/testing';
import { Router, type Routes } from '@angular/router';
import type { Language, Me } from '@smart/contracts';
import { UiSnackbar } from '@smart/ui';
import { vi } from 'vitest';
import { API_FETCH } from '../core/api';
import { AuthService, ME_CACHE } from '../core/auth';
import { HouseholdContext } from '../core/household';
import { MemoryMeCache, TEST_ME, json } from './auth-testing';
import { settle, setupPage } from './page-testing';

export interface RecordedCall {
  method: string;
  path: string;
  body: unknown;
}

/** Answers a request that is not `GET /me`; the default is 204. */
export type Responder = (call: RecordedCall) => Response | Promise<Response>;

/**
 * Opens `url` of a household page for a signed-in user: `GET /me` answers `state.me`, every other
 * request goes to `respond` and is recorded. The snackbar is a spy.
 */
export async function openHouseholdPage(
  routes: Routes,
  url: string,
  {
    me = TEST_ME,
    language = 'de',
    respond = () => new Response(null, { status: 204 }),
  }: { me?: Me; language?: Language; respond?: Responder } = {},
) {
  const calls: RecordedCall[] = [];
  const state = { me };
  // While a gate is up, answers to every request but `GET /me` wait for it (a slow server).
  let gate: Promise<void> | undefined;
  const snackbar = { show: vi.fn().mockResolvedValue(undefined) };
  const harness = await setupPage([...routes, { path: '**', children: [] }], language, [
    {
      provide: API_FETCH,
      useValue: async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const call = {
          method: init.method ?? 'GET',
          path: String(input),
          body: init.body ? JSON.parse(String(init.body)) : undefined,
        };
        calls.push(call);
        if (call.method === 'GET' && call.path === '/api/v1/me') return json(state.me);
        await gate;
        return respond(call);
      },
    },
    { provide: ME_CACHE, useValue: new MemoryMeCache() },
    { provide: UiSnackbar, useValue: snackbar },
  ]);
  await TestBed.inject(AuthService).load();
  await harness.navigateByUrl(url);
  await settle(harness);
  const element = harness.routeNativeElement as HTMLElement;
  return {
    harness,
    element,
    calls,
    state,
    snackbar,
    router: TestBed.inject(Router),
    auth: TestBed.inject(AuthService),
    household: TestBed.inject(HouseholdContext),
    /** Makes the server slow from now on; the returned function lets the waiting answers go. */
    hold(): () => void {
      let open!: () => void;
      gate = new Promise<void>((resolve) => (open = resolve));
      return () => {
        gate = undefined;
        open();
      };
    },
  };
}

export type OpenedHouseholdPage = Awaited<ReturnType<typeof openHouseholdPage>>;

export const pageText = (element: HTMLElement) =>
  element.textContent?.replace(/\s+/g, ' ').trim() ?? '';

export const pageButton = (element: HTMLElement, label: string) =>
  [...element.querySelectorAll('button, a')].find((candidate) =>
    candidate.textContent?.includes(label),
  ) as HTMLButtonElement | HTMLAnchorElement | undefined;

/** Lets pending promises run and renders. */
export async function flush(page: OpenedHouseholdPage, rounds = 4) {
  for (let round = 0; round < rounds; round++) {
    if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(0);
    else await new Promise((resolve) => setTimeout(resolve, 0));
    page.harness.detectChanges();
  }
}

export async function press(page: OpenedHouseholdPage, label: string) {
  const target = pageButton(page.element, label);
  if (!target) throw new Error(`No button "${label}" in: ${pageText(page.element)}`);
  target.click();
  await flush(page);
}

/** Types into the text field `name` (a `ui-text-field` with that `name`). */
export function typeInto(page: OpenedHouseholdPage, name: string, value: string) {
  page.harness.detectChanges();
  const input = page.element.querySelector<HTMLInputElement>(
    `ui-text-field[name="${name}"] input`,
  )!;
  input.value = value;
  input.dispatchEvent(new Event('input'));
  page.harness.detectChanges();
}
