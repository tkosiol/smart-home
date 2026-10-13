import { By } from '@angular/platform-browser';
import type { Language } from '@smart/contracts';
import { UiSelect } from '@smart/ui/forms';
import { TEST_ME, apiError, householdOf, json, meWith } from '../../testing/auth-testing';
import {
  flush,
  openHouseholdPage,
  pageButton,
  pageText,
  press,
  typeInto,
  type OpenedHouseholdPage,
  type RecordedCall,
  type Responder,
} from '../../testing/household-page-testing';
import { householdRoutes } from './households.routes';

const berlin = householdOf('Berlin', { timezone: 'Europe/Berlin', role: 'owner' });
const auckland = householdOf('Auckland', { timezone: 'Pacific/Auckland', role: 'owner' });
const routes = [{ path: 'mehr/haushalt', loadChildren: () => householdRoutes }];

const updated = { ...berlin, name: 'Neues Zuhause', timezone: 'Asia/Tokyo' };

function open(respond?: Responder, language: Language = 'de') {
  return openHouseholdPage(routes, '/mehr/haushalt', {
    language,
    me: meWith([berlin, auckland], berlin.id),
    respond:
      respond ??
      ((call: RecordedCall) =>
        call.method === 'PATCH' ? json(updated) : new Response(null, { status: 204 })),
  });
}

const requests = (page: OpenedHouseholdPage, method: string) =>
  page.calls.filter((call) => call.method === method);
const nameField = (page: OpenedHouseholdPage) =>
  page.element.querySelector<HTMLInputElement>('ui-text-field[name="name"] input')!;
const zoneSelect = (page: OpenedHouseholdPage) =>
  page.harness.fixture.debugElement.query(By.directive(UiSelect))
    .componentInstance as UiSelect<string>;

describe('household page', () => {
  afterEach(() => {
    vi.useRealTimers();
    document.documentElement.setAttribute('lang', 'de');
  });

  it.each([
    ['de', 'Haushalt', 'Haushalt verlassen', 'Speichern'],
    ['en', 'Household', 'Leave household', 'Save'],
  ] as const)('shows the current household in %s', async (language, title, leave, save) => {
    const page = await open(undefined, language);
    expect(page.element.querySelector('h1')?.textContent?.trim()).toBe(title);
    expect(page.element.querySelector('h2')?.textContent?.trim()).toBe(leave);
    expect(nameField(page).value).toBe('Berlin');
    expect(zoneSelect(page).value()).toBe('Europe/Berlin');
    expect(pageButton(page.element, save)).toBeTruthy();
  });

  describe('saving', () => {
    it('sends name and zone, then reloads the user and confirms', async () => {
      const page = await open();
      typeInto(page, 'name', ' Neues Zuhause ');
      zoneSelect(page).value.set('Asia/Tokyo');
      await press(page, 'Speichern');

      expect(requests(page, 'PATCH')).toEqual([
        {
          method: 'PATCH',
          path: `/api/v1/households/${berlin.id}`,
          body: { name: 'Neues Zuhause', timezone: 'Asia/Tokyo' },
        },
      ]);
      expect(page.calls.at(-1)).toMatchObject({ method: 'GET', path: '/api/v1/me' });
      expect(page.snackbar.show).toHaveBeenCalledWith('Gespeichert.');
    });

    it('shows an error at the field and sends nothing when the name is empty', async () => {
      const page = await open();
      typeInto(page, 'name', '  ');
      await press(page, 'Speichern');

      expect(requests(page, 'PATCH')).toEqual([]);
      expect(pageText(page.element)).toContain(
        'Bitte gib einen Namen mit höchstens 60 Zeichen ein.',
      );
    });

    it('reloads the access on 404 and says nothing else', async () => {
      const page = await open(() => apiError('household.notFound', 404));
      const accessChanged = vi.spyOn(page.household, 'accessChanged').mockResolvedValue();
      await press(page, 'Speichern');
      expect(accessChanged).toHaveBeenCalledOnce();
      expect(page.snackbar.show).not.toHaveBeenCalled();
    });

    it('reloads the access on 403', async () => {
      const page = await open(() => apiError('household.forbidden', 403));
      const accessChanged = vi.spyOn(page.household, 'accessChanged').mockResolvedValue();
      await press(page, 'Speichern');
      expect(accessChanged).toHaveBeenCalledOnce();
    });

    it('reports any other failure', async () => {
      const page = await open(() => apiError('internal', 500));
      const accessChanged = vi.spyOn(page.household, 'accessChanged').mockResolvedValue();
      await press(page, 'Speichern');
      expect(accessChanged).not.toHaveBeenCalled();
      expect(page.snackbar.show).toHaveBeenCalledWith(
        expect.stringContaining('Etwas ist schiefgegangen'),
        expect.anything(),
      );
    });
  });

  describe('following the current household', () => {
    it('shows the other household after a switch and saves there', async () => {
      const page = await open();
      page.auth.updateMe(meWith([berlin, auckland], auckland.id));
      await flush(page);

      expect(nameField(page).value).toBe('Auckland');
      expect(zoneSelect(page).value()).toBe('Pacific/Auckland');

      typeInto(page, 'name', 'Auckland 2');
      await press(page, 'Speichern');
      expect(requests(page, 'PATCH')[0].path).toBe(`/api/v1/households/${auckland.id}`);
    });
  });

  describe('leaving', () => {
    const leaveCall = {
      method: 'DELETE',
      path: `/api/v1/households/${berlin.id}/members/${TEST_ME.id}`,
      body: undefined,
    };

    it('asks again at the first press and leaves at the second', async () => {
      const page = await open();
      await press(page, 'Haushalt verlassen');
      expect(requests(page, 'DELETE')).toEqual([]);
      expect(pageButton(page.element, 'Wirklich verlassen?')).toBeTruthy();

      await press(page, 'Wirklich verlassen?');
      expect(requests(page, 'DELETE')).toEqual([leaveCall]);
    });

    it('reloads the user and goes on to the overview afterwards', async () => {
      const page = await open();
      page.state.me = meWith([auckland], null);
      await press(page, 'Haushalt verlassen');
      await press(page, 'Wirklich verlassen?');

      await vi.waitFor(() => expect(page.router.url).toBe('/'));
      expect(page.household.current()).toEqual(auckland);
    });

    it('goes back to the first step after five seconds', async () => {
      const page = await open();
      vi.useFakeTimers();
      await press(page, 'Haushalt verlassen');
      expect(pageButton(page.element, 'Wirklich verlassen?')).toBeTruthy();

      await vi.advanceTimersByTimeAsync(4900);
      page.harness.detectChanges();
      expect(pageButton(page.element, 'Wirklich verlassen?')).toBeTruthy();
      await vi.advanceTimersByTimeAsync(200);
      page.harness.detectChanges();

      expect(pageButton(page.element, 'Wirklich verlassen?')).toBeUndefined();
      expect(pageButton(page.element, 'Haushalt verlassen')).toBeTruthy();
      expect(requests(page, 'DELETE')).toEqual([]);
    });

    it('tells the last owner to name another one first', async () => {
      const page = await open((call) =>
        call.method === 'DELETE' ? apiError('household.lastOwner', 409) : json(updated),
      );
      await press(page, 'Haushalt verlassen');
      await press(page, 'Wirklich verlassen?');

      expect(pageText(page.element)).toContain('Ernenne zuerst eine andere Person zum Eigentümer.');
      expect(page.snackbar.show).not.toHaveBeenCalled();
      expect(page.router.url).toBe('/mehr/haushalt');
      expect(pageButton(page.element, 'Haushalt verlassen')).toBeTruthy();
    });

    it('translates the last-owner hint', async () => {
      const page = await open(
        (call) => (call.method === 'DELETE' ? apiError('household.lastOwner', 409) : json(updated)),
        'en',
      );
      await press(page, 'Leave household');
      await press(page, 'Really leave?');
      expect(pageText(page.element)).toContain('First make another person an owner.');
    });

    it('reloads the access on 404 and reports other failures', async () => {
      const gone = await open(() => apiError('household.notFound', 404));
      const accessChanged = vi.spyOn(gone.household, 'accessChanged').mockResolvedValue();
      await press(gone, 'Haushalt verlassen');
      await press(gone, 'Wirklich verlassen?');
      expect(accessChanged).toHaveBeenCalledOnce();
    });

    it('reports other failures', async () => {
      const page = await open(() => apiError('internal', 500));
      await press(page, 'Haushalt verlassen');
      await press(page, 'Wirklich verlassen?');
      expect(page.snackbar.show).toHaveBeenCalledOnce();
    });
  });
});
