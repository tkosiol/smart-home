import { apiError, householdOf, json, meWith } from '../../testing/auth-testing';
import {
  openHouseholdPage,
  pageButton,
  pageText,
  press,
  type Responder,
} from '../../testing/household-page-testing';
import { switchRoutes } from './households.routes';

const berlin = householdOf('Berlin', { timezone: 'Europe/Berlin', role: 'owner' });
const auckland = householdOf('Auckland', { timezone: 'Pacific/Auckland', role: 'viewer' });
const routes = [{ path: 'haushalte', loadChildren: () => switchRoutes }];

function open(respond?: Responder, language: 'de' | 'en' = 'de') {
  return openHouseholdPage(routes, '/haushalte', {
    language,
    me: meWith([berlin, auckland], berlin.id),
    respond: respond ?? (() => json(meWith([berlin, auckland], auckland.id))),
  });
}

describe('switch page', () => {
  afterEach(() => document.documentElement.setAttribute('lang', 'de'));

  it.each([
    [
      'de',
      'Haushalt wechseln',
      'Eigentümer',
      'Betrachter',
      'Aktueller Haushalt',
      'Neuen Haushalt anlegen',
    ],
    ['en', 'Switch household', 'Owner', 'Viewer', 'Current household', 'Create a new household'],
  ] as const)(
    'lists the households with their role in %s',
    async (language, title, owner, viewer, current, add) => {
      const { element } = await open(undefined, language);
      expect(element.querySelector('h1')?.textContent?.trim()).toBe(title);
      const sections = [...element.querySelectorAll('ui-section')];
      expect(sections.map((section) => section.querySelector('h2')?.textContent?.trim())).toEqual([
        'Berlin',
        'Auckland',
      ]);
      expect(sections[0].textContent).toContain(owner);
      expect(sections[1].textContent).toContain(viewer);
      expect(sections[0].textContent).toContain(current);
      expect(sections[1].textContent).not.toContain(current);
      expect(pageButton(element, add)?.getAttribute('href')).toBe('/einrichten');
    },
  );

  it('offers a switch button for the other households only', async () => {
    const { element } = await open();
    expect(pageButton(element, 'Zu Berlin wechseln')).toBeUndefined();
    expect(pageButton(element, 'Zu Auckland wechseln')).toBeTruthy();
  });

  it('switches on the server and leads to the overview', async () => {
    const page = await open();
    await press(page, 'Zu Auckland wechseln');

    expect(page.calls.at(-1)).toEqual({
      method: 'PUT',
      path: '/api/v1/me',
      body: { householdId: auckland.id },
    });
    await vi.waitFor(() => expect(page.router.url).toBe('/'));
    expect(page.household.current()).toEqual(auckland);
  });

  it('reloads the access when the server no longer knows the household', async () => {
    const page = await open(() => apiError('household.notFound', 404));
    const accessChanged = vi.spyOn(page.household, 'accessChanged').mockResolvedValue();
    await press(page, 'Zu Auckland wechseln');
    expect(accessChanged).toHaveBeenCalledOnce();
    expect(page.snackbar.show).not.toHaveBeenCalled();
    expect(pageText(page.element)).toContain('Auckland');
  });

  it('reports any other failure', async () => {
    const page = await open(() => apiError('internal', 500));
    await press(page, 'Zu Auckland wechseln');
    expect(page.snackbar.show).toHaveBeenCalledOnce();
    expect(page.router.url).toBe('/haushalte');
  });
});
