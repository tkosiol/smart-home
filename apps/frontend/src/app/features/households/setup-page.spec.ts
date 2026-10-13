import { By } from '@angular/platform-browser';
import type { Language } from '@smart/contracts';
import { UiSelect } from '@smart/ui/forms';
import { apiError, householdOf, json, meWith } from '../../testing/auth-testing';
import {
  openHouseholdPage,
  pageButton,
  pageText,
  press,
  typeInto,
  type OpenedHouseholdPage,
  type Responder,
} from '../../testing/household-page-testing';
import { setupRoutes } from './households.routes';

const created = householdOf('Zuhause', { timezone: 'Europe/Berlin' });
const routes = [
  { path: 'einrichten', loadChildren: () => setupRoutes },
  { path: 'haushalte', children: [] },
];

function open(
  respond: Responder = () => json(meWith([created])),
  { language = 'de', withHousehold = false }: { language?: Language; withHousehold?: boolean } = {},
) {
  return openHouseholdPage(routes, '/einrichten', {
    language,
    respond,
    me: meWith(withHousehold ? [householdOf('Alt')] : []),
  });
}

const posts = (page: OpenedHouseholdPage) => page.calls.filter((c) => c.method === 'POST');
const select = (page: OpenedHouseholdPage) =>
  page.harness.fixture.debugElement.query(By.directive(UiSelect))
    .componentInstance as UiSelect<string>;
const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

describe('setup page', () => {
  afterEach(() => document.documentElement.setAttribute('lang', 'de'));

  it.each([
    ['de', 'Haushalt einrichten', 'Name', 'Zeitzone', 'Haushalt anlegen'],
    ['en', 'Set up a household', 'Name', 'Time zone', 'Create household'],
  ] as const)('asks for name and time zone in %s', async (language, title, name, zone, submit) => {
    const { element } = await open(undefined, { language });
    expect(element.querySelector('main h1')?.textContent?.trim()).toBe(title);
    const labels = [...element.querySelectorAll('mat-label')].map((l) => l.textContent).join(' ');
    expect(labels).toContain(name);
    expect(labels).toContain(zone);
    expect(pageButton(element, submit)).toBeTruthy();
  });

  it('starts with an empty name and the zone of the browser', async () => {
    const page = await open();
    expect(
      page.element.querySelector<HTMLInputElement>('ui-text-field[name="name"] input')!.value,
    ).toBe('');
    expect(select(page).value()).toBe(browserZone);
    expect(
      select(page)
        .options()
        .some((option) => option.value === 'UTC'),
    ).toBe(true);
  });

  it('creates the household, takes over the answered me and goes to the overview', async () => {
    const page = await open();
    typeInto(page, 'name', '  Zuhause ');
    select(page).value.set('Europe/Berlin');
    await press(page, 'Haushalt anlegen');

    expect(posts(page)).toEqual([
      {
        method: 'POST',
        path: '/api/v1/households',
        body: { name: 'Zuhause', timezone: 'Europe/Berlin' },
      },
    ]);
    await vi.waitFor(() => expect(page.router.url).toBe('/'));
    expect(page.household.current()).toEqual(created);
  });

  it('shows an error at the field and sends nothing when the name is empty', async () => {
    const page = await open();
    typeInto(page, 'name', '   ');
    await press(page, 'Haushalt anlegen');

    expect(posts(page)).toEqual([]);
    expect(pageText(page.element)).toContain('Bitte gib einen Namen mit höchstens 60 Zeichen ein.');
    expect(
      page.element.querySelector('ui-text-field[name="name"] input')!.getAttribute('aria-invalid'),
    ).toBe('true');
    expect(page.router.url).toBe('/einrichten');
  });

  it('sends nothing for a name that is too long', async () => {
    const page = await open();
    typeInto(page, 'name', 'x'.repeat(61));
    await press(page, 'Haushalt anlegen');
    expect(posts(page)).toEqual([]);
    expect(pageText(page.element)).toContain('höchstens 60 Zeichen');
  });

  it('reports a failing server, stays and lets the user try again', async () => {
    const page = await open(() => apiError('internal', 500));
    typeInto(page, 'name', 'Zuhause');
    await press(page, 'Haushalt anlegen');
    expect(page.snackbar.show).toHaveBeenCalledWith(
      expect.stringContaining('Etwas ist schiefgegangen'),
      expect.anything(),
    );
    expect(page.router.url).toBe('/einrichten');
    expect((pageButton(page.element, 'Haushalt anlegen') as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  describe('cancel', () => {
    it('is not offered while there is no household', async () => {
      const { element } = await open();
      expect(pageButton(element, 'Abbrechen')).toBeUndefined();
    });

    it('leads back to the households when there already is one', async () => {
      const page = await open(undefined, { withHousehold: true });
      expect(pageButton(page.element, 'Abbrechen')?.getAttribute('href')).toBe('/haushalte');
    });
  });
});
