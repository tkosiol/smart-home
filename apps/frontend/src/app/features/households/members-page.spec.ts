import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import type { HouseholdRole, Invitation, Member } from '@smart/contracts';
import { UiSelect } from '@smart/ui/forms';
import { HouseholdContext } from '../../core/household';
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
} from '../../testing/household-page-testing';
import { WRITE_CLIPBOARD } from './invite-form';
import { memberRoutes } from './households.routes';

const berlin = householdOf('Berlin', { timezone: 'Europe/Berlin', role: 'owner' });
const berlinAsViewer = { ...berlin, role: 'viewer' as const };
const auckland = householdOf('Auckland', { timezone: 'Pacific/Auckland', role: 'owner' });
const routes = [{ path: 'mehr/mitglieder', loadChildren: () => memberRoutes }];
const base = `/api/v1/households/${berlin.id}`;

const member = (userId: string, displayName: string, role: HouseholdRole): Member => ({
  userId,
  displayName,
  email: `${displayName.toLowerCase()}@example.org`,
  role,
  joinedAt: '2026-09-01T08:00:00Z',
});
const till = member(TEST_ME.id, 'Till', 'owner');
const anna = member('user-anna', 'Anna', 'member');
const ben = member('user-ben', 'Ben', 'viewer');

const invitation = (id: string, email: string): Invitation => ({
  id,
  email,
  role: 'member',
  invitedByName: 'Till',
  createdAt: '2026-10-13T08:00:00Z',
  expiresAt: '2026-10-20T10:00:00Z',
});
const pending = invitation('inv-1', 'carla@example.org');

interface Server {
  members: Member[];
  invitations: Invitation[];
  fail?: (call: RecordedCall) => Response | undefined;
}

/** A small stand-in for the household API; `fail` may answer a call with an error first. */
function server(overrides: Partial<Server> = {}) {
  const state: Server = { members: [till, anna, ben], invitations: [pending], ...overrides };
  const respond = (call: RecordedCall): Response => {
    const failed = state.fail?.(call);
    if (failed) return failed;
    const path = call.path.replace(base, '');
    if (call.method === 'GET' && path === '/members') return json(state.members);
    if (call.method === 'GET' && path === '/invitations') return json(state.invitations);
    if (call.method === 'POST' && path === '/invitations') {
      const created = invitation('inv-2', (call.body as { email: string }).email);
      state.invitations = [...state.invitations, created];
      return json({ invitation: created, link: 'https://app.example.org/einladung/first' }, 201);
    }
    if (call.method === 'POST' && path.endsWith('/resend')) {
      return json(
        { invitation: state.invitations[0], link: 'https://app.example.org/einladung/second' },
        201,
      );
    }
    if (call.method === 'DELETE' && path.startsWith('/invitations/')) {
      state.invitations = state.invitations.filter((entry) => entry.id !== path.split('/')[2]);
    }
    if (call.method === 'DELETE' && path.startsWith('/members/')) {
      state.members = state.members.filter((entry) => entry.userId !== path.split('/')[2]);
    }
    return new Response(null, { status: 204 });
  };
  return { state, respond };
}

function open(
  {
    household = berlin,
    language = 'de',
    ...overrides
  }: Partial<Server> & { household?: typeof berlin; language?: 'de' | 'en' } = {},
  clipboard: ((text: string) => Promise<void>) | null = null,
) {
  TestBed.overrideProvider(WRITE_CLIPBOARD, { useValue: clipboard });
  const { state, respond } = server(overrides);
  return openHouseholdPage(routes, '/mehr/mitglieder', {
    language,
    me: meWith([household, auckland], household.id),
    respond,
  }).then((page) => Object.assign(page, { server: state }));
}

const requests = (page: OpenedHouseholdPage, method: string) =>
  page.calls.filter((call) => call.method === method);
const section = (page: OpenedHouseholdPage, heading: string) =>
  page.harness.fixture.debugElement
    .queryAll(By.css('ui-section'))
    .find(
      (candidate) =>
        candidate.nativeElement.querySelector(':scope > .header h3')?.textContent?.trim() ===
        heading,
    )!;
const selectOf = (page: OpenedHouseholdPage, heading: string) =>
  section(page, heading).query(By.directive(UiSelect)).componentInstance as UiSelect<string>;
const inviteSelect = (page: OpenedHouseholdPage) =>
  page.harness.fixture.debugElement.query(By.css('app-invite-form')).query(By.directive(UiSelect))
    .componentInstance as UiSelect<string>;
const sectionButton = (page: OpenedHouseholdPage, heading: string, label: string) =>
  [...section(page, heading).nativeElement.querySelectorAll('button')].find((button) =>
    (button as HTMLElement).textContent?.includes(label),
  ) as HTMLButtonElement | undefined;
const headings = (page: OpenedHouseholdPage) =>
  [...page.element.querySelectorAll('h3')].map((heading) => heading.textContent?.trim());
const field = (page: OpenedHouseholdPage, name: string) =>
  page.element.querySelector<HTMLInputElement>(`ui-text-field[name="${name}"] input`)!;
const linkField = (page: OpenedHouseholdPage) =>
  page.element.querySelector<HTMLInputElement>('input[readonly]');

describe('members page', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.documentElement.setAttribute('lang', 'de');
  });

  describe('list', () => {
    it.each([
      ['de', 'Mitglieder', 'Eigentümer', 'Betrachter'],
      ['en', 'Members', 'Owner', 'Viewer'],
    ] as const)('shows name, e-mail and role in %s', async (language, title, owner, viewer) => {
      const page = await open({ language });
      expect(page.element.querySelector('h1')?.textContent?.trim()).toBe(title);
      expect(headings(page)).toEqual(expect.arrayContaining(['Till', 'Anna', 'Ben']));
      expect(section(page, 'Anna').nativeElement.textContent).toContain('anna@example.org');
      expect(section(page, 'Till').nativeElement.textContent).toContain(owner);
      expect(section(page, 'Ben').nativeElement.textContent).toContain('ben@example.org');
      expect(requests(page, 'GET').map((call) => call.path)).toContain(`${base}/members`);
      expect(pageText(page.element)).toContain(viewer);
    });

    it('shows a viewer the list without controls and without invitations', async () => {
      const page = await open({ household: berlinAsViewer });
      expect(headings(page)).toEqual(['Till', 'Anna', 'Ben']);
      expect(page.element.querySelector('ui-select')).toBeNull();
      expect(pageButton(page.element, 'Entfernen')).toBeUndefined();
      expect(pageButton(page.element, 'Einladung senden')).toBeUndefined();
      expect(pageText(page.element)).not.toContain('Offene Einladungen');
      expect(requests(page, 'GET').map((call) => call.path)).not.toContain(`${base}/invitations`);
      // Everyone may leave, though.
      expect(sectionButton(page, 'Till', 'Verlassen')).toBeTruthy();
      expect(sectionButton(page, 'Anna', 'Verlassen')).toBeUndefined();
    });

    it('offers the owner role change and removal for the others, leaving for the own entry', async () => {
      const page = await open();
      expect(selectOf(page, 'Anna').value()).toBe('member');
      expect(sectionButton(page, 'Anna', 'Entfernen')).toBeTruthy();
      expect(sectionButton(page, 'Ben', 'Entfernen')).toBeTruthy();
      expect(section(page, 'Till').query(By.directive(UiSelect))).toBeNull();
      expect(sectionButton(page, 'Till', 'Entfernen')).toBeUndefined();
      expect(sectionButton(page, 'Till', 'Verlassen')).toBeTruthy();
    });
  });

  describe('changing a role', () => {
    it('patches the role of that member and reloads the list', async () => {
      const page = await open();
      selectOf(page, 'Anna').value.set('owner');
      await flush(page);

      expect(requests(page, 'PATCH')).toEqual([
        { method: 'PATCH', path: `${base}/members/user-anna`, body: { role: 'owner' } },
      ]);
      expect(requests(page, 'GET').filter((call) => call.path === `${base}/members`)).toHaveLength(
        2,
      );
    });

    it('says why the last owner cannot be demoted', async () => {
      const page = await open({
        members: [till, { ...anna, role: 'owner' }],
        fail: (call) =>
          call.method === 'PATCH' ? apiError('household.lastOwner', 409) : undefined,
      });
      selectOf(page, 'Anna').value.set('member');
      await flush(page);
      expect(page.snackbar.show).toHaveBeenCalledWith(
        'Ein Haushalt braucht mindestens eine Person mit der Rolle Eigentümer.',
        expect.anything(),
      );
    });
  });

  describe('removing and leaving', () => {
    it('removes a member only at the second press', async () => {
      const page = await open();
      sectionButton(page, 'Anna', 'Entfernen')!.click();
      await flush(page);
      expect(requests(page, 'DELETE')).toEqual([]);
      expect(sectionButton(page, 'Anna', 'Wirklich entfernen?')).toBeTruthy();
      expect(sectionButton(page, 'Ben', 'Entfernen')).toBeTruthy();

      sectionButton(page, 'Anna', 'Wirklich entfernen?')!.click();
      await flush(page);
      expect(requests(page, 'DELETE')).toEqual([
        { method: 'DELETE', path: `${base}/members/user-anna`, body: undefined },
      ]);
      expect(headings(page)).not.toContain('Anna');
    });

    it('closes the question after five seconds', async () => {
      const page = await open();
      vi.useFakeTimers();
      sectionButton(page, 'Anna', 'Entfernen')!.click();
      await flush(page);
      expect(sectionButton(page, 'Anna', 'Wirklich entfernen?')).toBeTruthy();
      await vi.advanceTimersByTimeAsync(4900);
      page.harness.detectChanges();
      expect(sectionButton(page, 'Anna', 'Wirklich entfernen?')).toBeTruthy();
      await vi.advanceTimersByTimeAsync(200);
      page.harness.detectChanges();
      expect(sectionButton(page, 'Anna', 'Entfernen')).toBeTruthy();
    });

    it('leaves with the own entry at the second press, reloads the user and goes home', async () => {
      const page = await open();
      sectionButton(page, 'Till', 'Verlassen')!.click();
      await flush(page);
      expect(requests(page, 'DELETE')).toEqual([]);

      sectionButton(page, 'Till', 'Wirklich verlassen?')!.click();
      await flush(page);
      expect(requests(page, 'DELETE')).toEqual([
        { method: 'DELETE', path: `${base}/members/${TEST_ME.id}`, body: undefined },
      ]);
      expect(page.calls.filter((call) => call.path === '/api/v1/me')).toHaveLength(2);
      expect(page.router.url).toBe('/');
    });

    it('says why the last owner cannot leave', async () => {
      const page = await open({
        fail: (call) =>
          call.method === 'DELETE' ? apiError('household.lastOwner', 409) : undefined,
      });
      sectionButton(page, 'Till', 'Verlassen')!.click();
      await flush(page);
      sectionButton(page, 'Till', 'Wirklich verlassen?')!.click();
      await flush(page);
      expect(page.snackbar.show).toHaveBeenCalledWith(
        'Ein Haushalt braucht mindestens eine Person mit der Rolle Eigentümer.',
        expect.anything(),
      );
      expect(page.router.url).toBe('/mehr/mitglieder');
    });
  });

  describe('invitations', () => {
    it('lists the open invitations with the expiry in the household time zone', async () => {
      const page = await open();
      const entry = section(page, 'carla@example.org').nativeElement as HTMLElement;
      expect(entry.textContent).toContain('Mitglied');
      // 10:00 UTC is 12:00 in Berlin.
      expect(entry.textContent).toMatch(/20\.10\.2026.*12:00/);
      expect(sectionButton(page, 'carla@example.org', 'Erneut senden')).toBeTruthy();
      expect(sectionButton(page, 'carla@example.org', 'Widerrufen')).toBeTruthy();
    });

    it('sends an invitation, shows the link once and copies it', async () => {
      const written: string[] = [];
      const page = await open({}, async (text) => void written.push(text));
      expect(linkField(page)).toBeNull();

      typeInto(page, 'email', ' Dora@Example.org ');
      inviteSelect(page).value.set('viewer');
      await press(page, 'Einladung senden');

      expect(requests(page, 'POST')).toEqual([
        {
          method: 'POST',
          path: `${base}/invitations`,
          body: { email: 'dora@example.org', role: 'viewer' },
        },
      ]);
      expect(linkField(page)!.value).toBe('https://app.example.org/einladung/first');
      expect(pageText(page.element)).toContain('nur jetzt');
      expect(headings(page)).toContain('dora@example.org');
      expect(field(page, 'email').value).toBe('');

      await press(page, 'Link kopieren');
      expect(written).toEqual(['https://app.example.org/einladung/first']);
      expect(page.snackbar.show).toHaveBeenCalledWith('Link kopiert');
    });

    it('keeps the link visible and selectable without the clipboard API', async () => {
      const page = await open({}, null);
      typeInto(page, 'email', 'dora@example.org');
      await press(page, 'Einladung senden');
      expect(linkField(page)!.value).toBe('https://app.example.org/einladung/first');
      expect(pageButton(page.element, 'Link kopieren')).toBeUndefined();
    });

    it('defaults the role of a new invitation to member', async () => {
      const page = await open();
      expect(inviteSelect(page).value()).toBe('member');
    });

    it('replaces the shown link when an invitation is sent again', async () => {
      const page = await open({}, async () => undefined);
      await press(page, 'Erneut senden');
      expect(requests(page, 'POST')).toEqual([
        { method: 'POST', path: `${base}/invitations/inv-1/resend`, body: undefined },
      ]);
      expect(linkField(page)!.value).toBe('https://app.example.org/einladung/second');
    });

    it('revokes only at the second press and removes the row', async () => {
      const page = await open();
      sectionButton(page, 'carla@example.org', 'Widerrufen')!.click();
      await flush(page);
      expect(requests(page, 'DELETE')).toEqual([]);

      sectionButton(page, 'carla@example.org', 'Wirklich widerrufen?')!.click();
      await flush(page);
      expect(requests(page, 'DELETE')).toEqual([
        { method: 'DELETE', path: `${base}/invitations/inv-1`, body: undefined },
      ]);
      expect(headings(page)).not.toContain('carla@example.org');
    });

    it('asks for a valid e-mail address and sends nothing otherwise', async () => {
      const page = await open();
      typeInto(page, 'email', 'not an address');
      await press(page, 'Einladung senden');
      expect(requests(page, 'POST')).toEqual([]);
      expect(pageText(page.element)).toContain('Bitte gib eine gültige E-Mail-Adresse ein.');
    });

    it('shows an existing member at the e-mail field', async () => {
      const page = await open({
        fail: (call) =>
          call.method === 'POST' ? apiError('invitation.alreadyMember', 409) : undefined,
      });
      typeInto(page, 'email', 'anna@example.org');
      await press(page, 'Einladung senden');
      expect(pageText(page.element)).toContain('Diese Person gehört schon zum Haushalt.');
      expect(page.snackbar.show).not.toHaveBeenCalled();
      expect(linkField(page)).toBeNull();
    });
  });

  describe('state', () => {
    it('keeps what is typed when the user is reloaded for the same household', async () => {
      const page = await open();
      typeInto(page, 'email', 'dora@example.org');
      page.auth.updateMe({ ...meWith([berlin, auckland], berlin.id), displayName: 'Till K.' });
      await flush(page);
      expect(field(page, 'email').value).toBe('dora@example.org');
    });

    it('starts over for another household', async () => {
      const page = await open();
      typeInto(page, 'email', 'dora@example.org');
      page.auth.updateMe(meWith([berlin, auckland], auckland.id));
      await flush(page);
      expect(field(page, 'email').value).toBe('');
      expect(requests(page, 'GET').map((call) => call.path)).toContain(
        `/api/v1/households/${auckland.id}/members`,
      );
    });
  });

  describe('errors', () => {
    it.each([
      ['household.forbidden', 403],
      ['household.notFound', 404],
    ] as const)('reloads the access on %s and says nothing else', async (code, status) => {
      const page = await open({
        fail: (call) => (call.method === 'DELETE' ? apiError(code, status) : undefined),
      });
      const accessChanged = vi.spyOn(page.household, 'accessChanged').mockResolvedValue();
      sectionButton(page, 'Anna', 'Entfernen')!.click();
      await flush(page);
      sectionButton(page, 'Anna', 'Wirklich entfernen?')!.click();
      await flush(page);
      expect(accessChanged).toHaveBeenCalledOnce();
      expect(page.snackbar.show).not.toHaveBeenCalled();
    });

    it('reloads the access when loading the list is forbidden', async () => {
      // The error comes while the page opens, so the spy goes on the class.
      const accessChanged = vi
        .spyOn(HouseholdContext.prototype, 'accessChanged')
        .mockResolvedValue();
      const page = await open({
        fail: (call) =>
          call.method === 'GET' && call.path.endsWith('/members')
            ? apiError('household.forbidden', 403)
            : undefined,
      });
      await flush(page);
      expect(accessChanged).toHaveBeenCalledOnce();
      expect(page.snackbar.show).not.toHaveBeenCalled();
    });

    it('shows a 403 that is not about the household as a message', async () => {
      const page = await open({
        fail: (call) => (call.method === 'PATCH' ? apiError('auth.badOrigin', 403) : undefined),
      });
      const accessChanged = vi.spyOn(page.household, 'accessChanged').mockResolvedValue();
      selectOf(page, 'Anna').value.set('owner');
      await flush(page);
      expect(accessChanged).not.toHaveBeenCalled();
      expect(page.snackbar.show).toHaveBeenCalledWith(
        'Die Anfrage kam von einer nicht erlaubten Adresse.',
        expect.anything(),
      );
    });
  });
});
