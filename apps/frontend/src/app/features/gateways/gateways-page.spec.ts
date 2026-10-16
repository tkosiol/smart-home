import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Gateway, Language, Me } from '@smart/contracts';
import { UiClock } from '@smart/ui';
import { HouseholdContext } from '../../core/household';
import { apiError, householdOf, json, meWith } from '../../testing/auth-testing';
import {
  flush,
  openHouseholdPage,
  pageButton,
  pageText,
  press,
  type OpenedHouseholdPage,
  type RecordedCall,
} from '../../testing/household-page-testing';
import { gatewaysRoutes } from './gateways.routes';

const berlin = householdOf('Berlin', { timezone: 'Europe/Berlin', role: 'owner' });
const auckland = householdOf('Auckland', { timezone: 'Pacific/Auckland', role: 'owner' });
const routes = [{ path: 'mehr/gateways', loadChildren: () => gatewaysRoutes }];
const base = `/api/v1/households/${berlin.id}`;
const NOW = Date.parse('2026-10-14T12:00:00Z');

const gateway = (id: string, name: string, overrides: Partial<Gateway> = {}): Gateway => ({
  id,
  name,
  kind: 'z2m',
  topicPrefix: `smart/gateways/${id}/z2m`,
  bridgeStatus: 'online',
  z2mStatus: 'online',
  statusChangedAt: '2026-10-14T08:00:00Z',
  lastMessageAt: '2026-10-14T11:55:00Z',
  certExpiresAt: '2027-04-01T10:00:00Z',
  revokedAt: null,
  warnings: [],
  ...overrides,
});
const flur = gateway('gw-aaaaaaaa', 'Flur');
const keller = gateway('gw-bbbbbbbb', 'Keller', { bridgeStatus: 'offline', z2mStatus: 'unknown' });
const PEM = '-----BEGIN CERTIFICATE-----\nMIIB\nabc=\n-----END CERTIFICATE-----\n';

/** Assembled from parts: a complete block in the source would trip the secret scanners. */
const keyBlock = (kind: string) =>
  ['-----BEGIN ', kind, '-----\nMIIB\n-----END ', kind, '-----\n'].join('');

interface Server {
  gateways: Gateway[];
  fail?: (call: RecordedCall) => Response | undefined;
  /** Holds the answer to a call until the returned promise is resolved. */
  hold?: (call: RecordedCall) => Promise<void> | undefined;
}

/** A small stand-in for the gateway API of the households; `fail` may answer a call first. */
function server(overrides: Partial<Server> = {}) {
  const state: Server = { gateways: [flur, keller], ...overrides };
  const respond = async (call: RecordedCall): Promise<Response> => {
    await state.hold?.(call);
    const failed = state.fail?.(call);
    if (failed) return failed;
    if (call.method === 'GET' && call.path === `/api/v1/households/${auckland.id}/gateways`) {
      return json([gateway('gw-cccccccc', 'Garten')]);
    }
    const path = call.path.replace(base, '');
    if (call.method === 'GET' && path === '/gateways') return json(state.gateways);
    if (call.method === 'POST' && path === '/gateways') {
      const created = gateway('gw-dddddddd', (call.body as { name: string }).name, {
        bridgeStatus: 'unknown',
        z2mStatus: 'unknown',
        lastMessageAt: null,
      });
      state.gateways = [...state.gateways, created];
      return json(created, 201);
    }
    if (call.method === 'POST' && path.endsWith('/revoke')) {
      const id = path.split('/')[2];
      state.gateways = state.gateways.map((entry) =>
        entry.id === id ? { ...entry, revokedAt: '2026-10-14T12:00:00Z' } : entry,
      );
    }
    return new Response(null, { status: 204 });
  };
  return { state, respond };
}

function open({
  admin = false,
  language = 'de',
  ...overrides
}: Partial<Server> & { admin?: boolean; language?: Language } = {}) {
  TestBed.overrideProvider(UiClock, { useValue: { now: signal(NOW) } });
  const { state, respond } = server(overrides);
  const me: Me = { ...meWith([berlin, auckland], berlin.id), isPlatformAdmin: admin };
  return openHouseholdPage(routes, '/mehr/gateways', { language, me, respond }).then((page) =>
    Object.assign(page, { server: state }),
  );
}

const requests = (page: OpenedHouseholdPage, method: string) =>
  page.calls.filter((call) => call.method === method);
/** The card of one gateway: its status entry carries the name. */
const entry = (page: OpenedHouseholdPage, name: string) =>
  ([...page.element.querySelectorAll('ui-card')] as HTMLElement[]).find(
    (candidate) => candidate.querySelector('ui-status-entry .title')?.textContent?.trim() === name,
  )!;
const entryText = (page: OpenedHouseholdPage, name: string) => pageText(entry(page, name));
const entryButton = (page: OpenedHouseholdPage, name: string, label: string) =>
  [...entry(page, name).querySelectorAll('button')].find((button) =>
    button.textContent?.includes(label),
  );
const nameField = (page: OpenedHouseholdPage) =>
  page.element.querySelector<HTMLInputElement>('ui-text-field[name="name"] input')!;
const certificateField = (page: OpenedHouseholdPage) =>
  page.element.querySelector<HTMLTextAreaElement>('ui-text-field[name="certificate"] textarea')!;

function fill(page: OpenedHouseholdPage, name: string, certificate: string) {
  for (const [field, value] of [
    [nameField(page), name],
    [certificateField(page), certificate],
  ] as const) {
    field.value = value;
    field.dispatchEvent(new Event('input'));
  }
  page.harness.detectChanges();
}

describe('gateways page', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.documentElement.setAttribute('lang', 'de');
  });

  describe('list for an owner', () => {
    it('loads the gateways of the current household and shows them without a form', async () => {
      const page = await open();
      expect(page.element.querySelector('h1')?.textContent?.trim()).toBe('Gateways');
      expect(page.calls.filter((call) => call.path === `${base}/gateways`)).toHaveLength(1);
      expect(entry(page, 'Flur')).toBeTruthy();
      expect(entry(page, 'Keller')).toBeTruthy();
      expect(page.element.querySelector('ui-text-field')).toBeNull();
      expect(pageButton(page.element, 'Gateway registrieren')).toBeUndefined();
      expect(pageButton(page.element, 'Sperren')).toBeUndefined();
    });

    it('shows both statuses, the last message relative and the certificate expiry in the household zone', async () => {
      const page = await open();
      const text = entryText(page, 'Flur');
      expect(text).toContain('Bridge: Online');
      expect(text).toContain('Zigbee2MQTT: Online');
      expect(text).toContain('Letzte Nachricht vor 5 Minuten');
      expect(text).toContain('Zertifikat gültig bis 01.04.2027');
      expect(entryText(page, 'Keller')).toContain('Bridge: Offline');
      expect(entryText(page, 'Keller')).toContain('Zigbee2MQTT: Unbekannt');
    });

    it('shows dates in the time zone of the household, not in UTC', async () => {
      const page = await open({
        gateways: [gateway('gw-eeeeeeee', 'Neu', { certExpiresAt: '2027-03-31T23:00:00Z' })],
      });
      expect(entryText(page, 'Neu')).toContain('Zertifikat gültig bis 01.04.2027');
    });

    it('says so when no message has arrived yet', async () => {
      const page = await open({
        gateways: [gateway('gw-eeeeeeee', 'Neu', { lastMessageAt: null })],
      });
      expect(entryText(page, 'Neu')).toContain('Noch keine Nachricht empfangen');
    });

    it('shows the page in English', async () => {
      const page = await open({ language: 'en' });
      const text = entryText(page, 'Flur');
      expect(text).toContain('Bridge: Online');
      expect(text).toContain('Zigbee2MQTT: Online');
      expect(text).toContain('Last message 5 minutes ago');
      expect(text).toContain('Certificate valid until Apr 1, 2027');
      expect(entryText(page, 'Keller')).toContain('Zigbee2MQTT: Unknown');
    });

    it('shows a revoked gateway as revoked, without statuses or a revoke button', async () => {
      const page = await open({
        admin: true,
        gateways: [gateway('gw-ffffffff', 'Alt', { revokedAt: '2026-10-01T09:00:00Z' })],
      });
      const text = entryText(page, 'Alt');
      expect(text).toContain('Gesperrt am 01.10.2026');
      expect(text).not.toContain('Bridge:');
      expect(entryButton(page, 'Alt', 'Sperren')).toBeUndefined();
    });

    it('explains the empty list and points to the runbook', async () => {
      const page = await open({ gateways: [] });
      const text = pageText(page.element);
      expect(text).toContain('Noch keine Gateways');
      expect(text).toContain('Runbook');
    });

    it.each([
      ['de', 'auf deinem Rechner'],
      ['en', 'on your own computer'],
    ] as const)(
      'places the CA on the operator computer, not on the server (%s)',
      async (language, computer) => {
        const page = await open({ language, gateways: [] });
        const text = pageText(page.element);
        expect(text).toContain(computer);
        expect(text).not.toMatch(/auf dem Server|on the server/);
      },
    );

    it.each([
      ['de', 'auf deinem Rechner'],
      ['en', 'on your own computer'],
    ] as const)('says where to renew the revocation list (%s)', async (language, computer) => {
      const page = await open({ language, gateways: [{ ...flur, warnings: ['crlExpiring'] }] });
      const text = pageText(page.element);
      expect(text).toContain(computer);
      expect(text).not.toMatch(/auf dem Server|on the server/);
    });

    it('does not show the empty state while the list is loading', async () => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const page = await open({
        gateways: [],
        hold: (call) =>
          call.method === 'GET' && call.path.endsWith('/gateways') ? gate : undefined,
      });
      expect(pageText(page.element)).not.toContain('Noch keine Gateways');
      release();
      await flush(page);
      expect(pageText(page.element)).toContain('Noch keine Gateways');
    });
  });

  describe('warnings', () => {
    const expiring = gateway('gw-aaaaaaaa', 'Flur', {
      certExpiresAt: '2026-10-26T12:00:00Z',
      warnings: ['certExpiring'],
    });

    it('shows the days left of an expiring certificate', async () => {
      const page = await open({ gateways: [expiring] });
      expect(entryText(page, 'Flur')).toContain('Das Zertifikat läuft in 12 Tagen ab.');
      expect(
        entry(page, 'Flur').querySelector('ui-status-chip[data-tone="warning-container"]'),
      ).toBeTruthy();
    });

    it('rounds partial days up and names the last day', async () => {
      const page = await open({
        gateways: [{ ...expiring, certExpiresAt: '2026-10-14T20:00:00Z' }],
      });
      expect(entryText(page, 'Flur')).toContain(
        'Das Zertifikat läuft in weniger als einem Tag ab.',
      );
    });

    it('shows an expired certificate', async () => {
      const page = await open({
        gateways: [
          gateway('gw-aaaaaaaa', 'Flur', {
            certExpiresAt: '2026-10-10T12:00:00Z',
            warnings: ['certExpired'],
          }),
        ],
      });
      expect(entryText(page, 'Flur')).toContain('Das Zertifikat ist abgelaufen.');
    });

    it('shows the expiring revocation list once for the whole page', async () => {
      const page = await open({
        gateways: [
          { ...flur, warnings: ['crlExpiring'] },
          { ...keller, warnings: ['crlExpiring'] },
        ],
      });
      const text = pageText(page.element);
      expect(text.match(/Die Sperrliste läuft bald ab/g)).toHaveLength(1);
      expect(page.element.querySelectorAll('ui-banner')).toHaveLength(1);
    });

    it('shows no banner without warnings', async () => {
      const page = await open();
      expect(page.element.querySelector('ui-banner')).toBeNull();
    });

    it('translates the warnings', async () => {
      const page = await open({
        language: 'en',
        gateways: [{ ...expiring, warnings: ['certExpiring', 'crlExpiring'] }],
      });
      const text = pageText(page.element);
      expect(text).toContain('The certificate expires in 12 days.');
      expect(text).toContain('The revocation list expires soon');
    });
  });

  describe('registering', () => {
    it('shows the form to platform admins only', async () => {
      const admin = await open({ admin: true });
      expect(nameField(admin)).toBeTruthy();
      expect(certificateField(admin)).toBeTruthy();
      expect(pageButton(admin.element, 'Gateway registrieren')).toBeTruthy();
      expect(entryButton(admin, 'Flur', 'Sperren')).toBeTruthy();
    });

    it('sends exactly the name and the certificate and shows the new gateway', async () => {
      const page = await open({ admin: true });
      fill(page, '  Terrasse ', PEM);
      await press(page, 'Gateway registrieren');
      const posts = requests(page, 'POST');
      expect(posts).toEqual([
        { method: 'POST', path: `${base}/gateways`, body: { name: 'Terrasse', certificate: PEM } },
      ]);
      expect(entry(page, 'Terrasse')).toBeTruthy();
      expect(nameField(page).value).toBe('');
      expect(certificateField(page).value).toBe('');
    });

    it('does not send an empty name or certificate', async () => {
      const page = await open({ admin: true });
      await press(page, 'Gateway registrieren');
      expect(requests(page, 'POST')).toHaveLength(0);
      expect(pageText(page.element)).toContain(
        'Bitte gib einen Namen mit höchstens 60 Zeichen ein.',
      );
      expect(pageText(page.element)).toContain(
        'Bitte füge das Zertifikat ein (höchstens 20.000 Zeichen).',
      );
      fill(page, 'Terrasse', '');
      await press(page, 'Gateway registrieren');
      expect(requests(page, 'POST')).toHaveLength(0);
      expect(pageText(page.element)).not.toContain('Bitte gib einen Namen');
      expect(certificateField(page).getAttribute('aria-invalid')).toBe('true');
    });

    it('keeps the browser from checking, capitalizing or correcting the certificate', async () => {
      const page = await open({ admin: true });
      const field = certificateField(page);
      expect(field.getAttribute('spellcheck')).toBe('false');
      expect(field.getAttribute('autocomplete')).toBe('off');
      expect(field.getAttribute('autocapitalize')).toBe('off');
    });

    it.each([
      ['de', 'Gateway registrieren', 'Das sieht nach einem privaten Schlüssel aus'],
      ['en', 'Register gateway', 'This looks like a private key'],
    ] as const)(
      'does not send text with a private key (%s) and says what belongs in the field',
      async (language, button, message) => {
        const page = await open({ admin: true, language });
        for (const key of [
          keyBlock('PRIVATE KEY'),
          keyBlock('RSA PRIVATE KEY'),
          keyBlock('encrypted private key'),
          `${PEM}${keyBlock('EC PRIVATE KEY')}`,
        ]) {
          fill(page, 'Terrasse', key);
          await press(page, button);
          expect(requests(page, 'POST')).toHaveLength(0);
          expect(pageText(page.element)).toContain(message);
          expect(certificateField(page).getAttribute('aria-invalid')).toBe('true');
          expect(page.snackbar.show).not.toHaveBeenCalled();
        }
        // Removing the key clears the message again; the certificate alone is sent.
        fill(page, 'Terrasse', PEM);
        expect(pageText(page.element)).not.toContain(message);
        await press(page, button);
        expect(requests(page, 'POST')).toHaveLength(1);
      },
    );

    it.each([
      [
        'gateway.invalidCertificate',
        400,
        'de',
        'Das Zertifikat ist ungültig, abgelaufen oder nicht von dieser Instanz ausgestellt.',
      ],
      ['gateway.exists', 409, 'de', 'Dieses Gateway ist schon registriert.'],
      [
        'gateway.caMissing',
        503,
        'de',
        'Auf dieser Instanz ist keine Zertifizierungsstelle eingerichtet.',
      ],
      [
        'gateway.invalidCertificate',
        400,
        'en',
        'The certificate is invalid, expired or was not issued by this instance.',
      ],
      ['gateway.exists', 409, 'en', 'This gateway is already registered.'],
      ['gateway.caMissing', 503, 'en', 'No certificate authority is set up on this instance.'],
    ] as const)(
      'shows %s (%s) in %s next to the certificate',
      async (code, status, language, text) => {
        const page = await open({
          admin: true,
          language,
          fail: (call) => (call.method === 'POST' ? apiError(code, status) : undefined),
        });
        fill(page, 'Terrasse', PEM);
        await press(page, language === 'de' ? 'Gateway registrieren' : 'Register gateway');
        expect(pageText(page.element)).toContain(text);
        expect(certificateField(page).getAttribute('aria-invalid')).toBe('true');
        // What was typed stays, so it can be corrected.
        expect(certificateField(page).value).toBe(PEM);
        expect(nameField(page).value).toBe('Terrasse');
        expect(page.snackbar.show).not.toHaveBeenCalled();
      },
    );

    it('clears the message when the certificate is changed', async () => {
      const page = await open({
        admin: true,
        fail: (call) =>
          call.method === 'POST' ? apiError('gateway.invalidCertificate', 400) : undefined,
      });
      fill(page, 'Terrasse', PEM);
      await press(page, 'Gateway registrieren');
      expect(certificateField(page).getAttribute('aria-invalid')).toBe('true');
      fill(page, 'Terrasse', `${PEM}x`);
      expect(certificateField(page).getAttribute('aria-invalid')).toBe('false');
      expect(pageText(page.element)).not.toContain('Das Zertifikat ist ungültig');
    });

    it('shows a missing platform admin right as a message', async () => {
      const page = await open({
        admin: true,
        fail: (call) => (call.method === 'POST' ? apiError('auth.forbidden', 403) : undefined),
      });
      const accessChanged = vi.spyOn(page.household, 'accessChanged').mockResolvedValue();
      fill(page, 'Terrasse', PEM);
      await press(page, 'Gateway registrieren');
      expect(page.snackbar.show).toHaveBeenCalledWith(
        'Dafür fehlt dir die Berechtigung.',
        expect.anything(),
      );
      expect(accessChanged).not.toHaveBeenCalled();
    });

    it('reloads the access on household.forbidden', async () => {
      const page = await open({
        admin: true,
        fail: (call) => (call.method === 'POST' ? apiError('household.forbidden', 403) : undefined),
      });
      const accessChanged = vi.spyOn(page.household, 'accessChanged').mockResolvedValue();
      fill(page, 'Terrasse', PEM);
      await press(page, 'Gateway registrieren');
      expect(accessChanged).toHaveBeenCalledOnce();
    });
  });

  describe('revoking', () => {
    afterEach(() => vi.useRealTimers());

    it('asks again first and revokes with the second press', async () => {
      const page = await open({ admin: true });
      await press(page, 'Sperren');
      expect(requests(page, 'POST')).toHaveLength(0);
      expect(entryButton(page, 'Flur', 'Wirklich sperren?')).toBeTruthy();
      await press(page, 'Wirklich sperren?');
      expect(requests(page, 'POST')).toEqual([
        { method: 'POST', path: `${base}/gateways/${flur.id}/revoke`, body: undefined },
      ]);
      expect(entryText(page, 'Flur')).toContain('Gesperrt am 14.10.2026');
      expect(entryButton(page, 'Flur', 'Sperren')).toBeUndefined();
    });

    it('points to pki.sh revoke and broker-certs.sh after revoking', async () => {
      const page = await open({ admin: true });
      expect(pageText(page.element)).not.toContain('pki.sh revoke');
      await press(page, 'Sperren');
      await press(page, 'Wirklich sperren?');
      const text = pageText(page.element);
      expect(text).toContain('pki.sh revoke');
      expect(text).toContain('broker-certs.sh');
    });

    it('closes the question after five seconds', async () => {
      const page = await open({ admin: true });
      vi.useFakeTimers();
      await press(page, 'Sperren');
      expect(pageButton(page.element, 'Wirklich sperren?')).toBeTruthy();
      await vi.advanceTimersByTimeAsync(4900);
      page.harness.detectChanges();
      expect(pageButton(page.element, 'Wirklich sperren?')).toBeTruthy();
      await vi.advanceTimersByTimeAsync(200);
      page.harness.detectChanges();
      expect(pageButton(page.element, 'Wirklich sperren?')).toBeUndefined();
      expect(requests(page, 'POST')).toHaveLength(0);
    });

    it('asks again for another gateway', async () => {
      const page = await open({ admin: true });
      await press(page, 'Sperren');
      const other = entryButton(page, 'Keller', 'Sperren')!;
      other.click();
      await flush(page);
      expect(requests(page, 'POST')).toHaveLength(0);
      expect(entryButton(page, 'Keller', 'Wirklich sperren?')).toBeTruthy();
      expect(entryButton(page, 'Flur', 'Wirklich sperren?')).toBeUndefined();
    });

    it('reloads the list when the gateway is gone and reloads the access', async () => {
      const page = await open({
        admin: true,
        fail: (call) => (call.method === 'POST' ? apiError('household.notFound', 404) : undefined),
      });
      const accessChanged = vi.spyOn(page.household, 'accessChanged').mockResolvedValue();
      const loads = requests(page, 'GET').length;
      await press(page, 'Sperren');
      await press(page, 'Wirklich sperren?');
      expect(accessChanged).toHaveBeenCalledOnce();
      expect(requests(page, 'GET').length).toBe(loads + 1);
    });

    it('shows other errors as a message', async () => {
      const page = await open({
        admin: true,
        fail: (call) => (call.method === 'POST' ? apiError('auth.forbidden', 403) : undefined),
      });
      await press(page, 'Sperren');
      await press(page, 'Wirklich sperren?');
      expect(page.snackbar.show).toHaveBeenCalledWith(
        'Dafür fehlt dir die Berechtigung.',
        expect.anything(),
      );
    });
  });

  describe('household changes', () => {
    it('loads the gateways of another household', async () => {
      const page = await open({ admin: true });
      page.auth.updateMe({ ...meWith([berlin, auckland], auckland.id), isPlatformAdmin: true });
      await flush(page);
      expect(page.calls.at(-1)?.path).toBe(`/api/v1/households/${auckland.id}/gateways`);
      expect(entry(page, 'Garten')).toBeTruthy();
      expect(entry(page, 'Flur')).toBeUndefined();
    });

    it('keeps the list and what is typed when the user is reloaded for the same household', async () => {
      const page = await open({ admin: true });
      fill(page, 'Terrasse', PEM);
      const loads = requests(page, 'GET').length;
      page.auth.updateMe({
        ...meWith([berlin, auckland], berlin.id),
        isPlatformAdmin: true,
        displayName: 'Till K.',
      });
      await flush(page);
      expect(requests(page, 'GET').length).toBe(loads);
      expect(nameField(page).value).toBe('Terrasse');
      expect(entry(page, 'Flur')).toBeTruthy();
    });

    it('starts the form, an open question and the revoke hint over for another household', async () => {
      const page = await open({ admin: true });
      fill(page, 'Terrasse', PEM);
      await press(page, 'Sperren');
      page.auth.updateMe({ ...meWith([berlin, auckland], auckland.id), isPlatformAdmin: true });
      await flush(page);
      expect(nameField(page).value).toBe('');
      expect(certificateField(page).value).toBe('');
      expect(pageButton(page.element, 'Wirklich sperren?')).toBeUndefined();
    });

    it('drops the revoke hint for another household', async () => {
      const page = await open({ admin: true });
      await press(page, 'Sperren');
      await press(page, 'Wirklich sperren?');
      expect(pageText(page.element)).toContain('pki.sh revoke');
      page.auth.updateMe({ ...meWith([berlin, auckland], auckland.id), isPlatformAdmin: true });
      await flush(page);
      expect(pageText(page.element)).not.toContain('pki.sh revoke');
    });

    it('ignores the late answer for the household the user has left', async () => {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const page = await open({
        hold: (call) => (call.path.startsWith(`${base}/`) ? gate : undefined),
      });
      page.auth.updateMe({ ...meWith([berlin, auckland], auckland.id), isPlatformAdmin: false });
      await flush(page);
      release();
      await flush(page);
      expect(entry(page, 'Garten')).toBeTruthy();
      expect(entry(page, 'Flur')).toBeUndefined();
    });
  });

  describe('errors while loading', () => {
    it.each([
      ['household.forbidden', 403],
      ['household.notFound', 404],
    ] as const)('reloads the access on %s', async (code, status) => {
      const accessChanged = vi
        .spyOn(HouseholdContext.prototype, 'accessChanged')
        .mockResolvedValue();
      await open({
        fail: (call) =>
          call.method === 'GET' && call.path.endsWith('/gateways')
            ? apiError(code, status)
            : undefined,
      });
      expect(accessChanged).toHaveBeenCalledOnce();
    });

    it('shows other errors as a message and no empty state', async () => {
      const page = await open({
        fail: (call) =>
          call.method === 'GET' && call.path.endsWith('/gateways')
            ? apiError('internal', 500)
            : undefined,
      });
      expect(page.snackbar.show).toHaveBeenCalled();
      expect(pageText(page.element)).not.toContain('Noch keine Gateways');
    });
  });
});
