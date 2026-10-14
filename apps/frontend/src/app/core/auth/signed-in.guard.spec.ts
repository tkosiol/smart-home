import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, type Routes } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { API_FETCH } from '../api';
import { apiError, json, MemoryMeCache, TEST_ME } from '../../testing/auth-testing';
import { ME_CACHE } from './me-cache';
import { signedIn } from './signed-in.guard';

const routes: Routes = [
  { path: 'anmelden', children: [] },
  {
    path: '',
    canMatch: [signedIn],
    children: [
      { path: '', pathMatch: 'full', children: [] },
      { path: 'mehr', children: [{ path: 'einstellungen', children: [] }] },
    ],
  },
];

async function navigate(url: string, respond: () => Response, cached = false) {
  const fetchFn = vi.fn(async () => respond());
  TestBed.configureTestingModule({
    providers: [
      provideRouter(routes),
      { provide: API_FETCH, useValue: fetchFn },
      { provide: ME_CACHE, useValue: new MemoryMeCache(cached ? TEST_ME : null) },
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  return { router: TestBed.inject(Router), fetchFn, harness };
}

const unreachable = () => {
  throw new TypeError('Failed to fetch');
};

describe('signedIn guard', () => {
  it('lets a signed-in user through', async () => {
    const { router } = await navigate('/mehr/einstellungen', () => json(TEST_ME));
    expect(router.url).toBe('/mehr/einstellungen');
  });

  it('lets a user through who starts offline with a copy', async () => {
    const { router } = await navigate('/mehr', unreachable, true);
    expect(router.url).toBe('/mehr');
  });

  it('sends a signed-out user to the sign-in page with the wanted URL', async () => {
    const { router } = await navigate('/mehr/einstellungen?tab=2', () =>
      apiError('auth.required', 401),
    );
    expect(router.url).toBe('/anmelden?ziel=%2Fmehr%2Feinstellungen%3Ftab%3D2');
  });

  it('leaves the target out for the start page', async () => {
    const { router } = await navigate('/', () => apiError('auth.required', 401));
    expect(router.url).toBe('/anmelden');
  });

  it('sends a user without connection and without a copy to the sign-in page', async () => {
    const { router } = await navigate('/mehr', unreachable);
    expect(router.url).toBe('/anmelden?ziel=%2Fmehr');
  });

  it('waits for the first answer and asks only once for several navigations', async () => {
    const { router, fetchFn, harness } = await navigate('/mehr', () => json(TEST_ME));
    await harness.navigateByUrl('/');
    await harness.navigateByUrl('/mehr/einstellungen');
    expect(router.url).toBe('/mehr/einstellungen');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
