import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Gateway, GatewayPairing, Language, Me } from '@smart/contracts';
import { UiClock } from '@smart/ui';
import { WRITE_CLIPBOARD } from '../../core/clipboard';
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
const berlinAsMember = { ...berlin, role: 'member' as const };
const routes = [{ path: 'mehr/gateways', loadChildren: () => gatewaysRoutes }];
const base = `/api/v1/households/${berlin.id}`;
const NOW = Date.parse('2026-10-14T12:00:00Z');
const EXPIRES = '2026-10-14T12:15:00Z';

const gateway = (id: string, name: string, overrides: Partial<Gateway> = {}): Gateway => ({
  id,
  name,
  kind: 'ha',
  auth: 'credentials',
  topicPrefix: `smart/gateways/${id}/ha`,
  bridgeStatus: 'online',
  serviceStatus: 'online',
  statusChangedAt: '2026-10-14T08:00:00Z',
  lastMessageAt: '2026-10-14T11:55:00Z',
  certExpiresAt: null,
  credentialGeneration: 1,
  revokedAt: null,
  warnings: [],
  ...overrides,
});
const flur = gateway('gw-aaaaaaaa', 'Flur', {
  kind: 'z2m',
  auth: 'certificate',
  credentialGeneration: null,
});
const wohnung = gateway('gw-bbbbbbbb', 'Wohnung');
const pairing: GatewayPairing = {
  code: 'AB3D-EF9H',
  expiresAt: EXPIRES,
  appUrl: 'https://smart.example.org',
};

interface Server {
  gateways: Gateway[];
  fail?: (call: RecordedCall) => Response | undefined;
}

async function open({
  role = 'owner',
  clipboard = null,
  language = 'de',
  ...overrides
}: Partial<Server> & {
  role?: 'owner' | 'member';
  clipboard?: ((text: string) => Promise<void>) | null;
  language?: Language;
} = {}) {
  TestBed.overrideProvider(UiClock, { useValue: { now: signal(NOW) } });
  TestBed.overrideProvider(WRITE_CLIPBOARD, { useValue: clipboard });
  const state: Server = { gateways: [flur, wohnung], ...overrides };
  const household = role === 'owner' ? berlin : berlinAsMember;
  const me: Me = meWith([household], household.id);
  const page = await openHouseholdPage(routes, '/mehr/gateways', {
    me,
    language,
    respond: (call) => {
      const failed = state.fail?.(call);
      if (failed) return failed;
      if (call.method === 'GET' && call.path === `${base}/gateways`) return json(state.gateways);
      if (call.method === 'POST' && call.path === `${base}/gateway-pairings`) {
        return json(pairing, 201);
      }
      return new Response(null, { status: 204 });
    },
  });
  return Object.assign(page, { server: state });
}

const pairings = (page: OpenedHouseholdPage) =>
  page.calls.filter((call) => call.path === `${base}/gateway-pairings`);
const listCalls = (page: OpenedHouseholdPage) =>
  page.calls.filter((call) => call.method === 'GET' && call.path === `${base}/gateways`);
const text = (page: OpenedHouseholdPage) => pageText(page.element);
const link = (page: OpenedHouseholdPage, label: string) =>
  pageButton(page.element, label) as HTMLAnchorElement | undefined;

/** Lets the polling timer run for `ms` and renders. */
async function wait(page: OpenedHouseholdPage, ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
  await flush(page);
}

describe('home assistant pairing', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('new gateway', () => {
    it('is offered to owners only', async () => {
      const owner = await open();
      expect(text(owner)).toContain('Home Assistant koppeln');
      expect(pageButton(owner.element, 'Code erzeugen')).toBeTruthy();
      TestBed.resetTestingModule();
      const member = await open({ role: 'member' });
      expect(text(member)).not.toContain('Home Assistant koppeln');
      expect(pageButton(member.element, 'Code erzeugen')).toBeUndefined();
    });

    it('creates no code before the button is pressed', async () => {
      const page = await open();
      expect(pairings(page)).toHaveLength(0);
    });

    it('shows the code, the time in the household zone, the address and the steps', async () => {
      const page = await open();
      await press(page, 'Code erzeugen');
      expect(pairings(page)).toEqual([
        { method: 'POST', path: `${base}/gateway-pairings`, body: {} },
      ]);
      const shown = text(page);
      expect(shown).toContain('AB3D-EF9H');
      expect(shown).toContain('Gültig bis 14:15');
      expect(shown).toContain('https://smart.example.org');
      expect(shown).toContain('HACS');
      expect(link(page, 'In Home Assistant öffnen')!.getAttribute('href')).toBe(
        'https://my.home-assistant.io/redirect/config_flow_start/?domain=smart_bridge',
      );
      expect(link(page, 'Anleitung')!.getAttribute('href')).toBe(
        'https://github.com/tkosiol/smart-home-hacs',
      );
      expect(link(page, 'Anleitung')!.getAttribute('rel')).toContain('noopener');
    });

    it('copies the address when the browser can', async () => {
      const copy = vi.fn().mockResolvedValue(undefined);
      const page = await open({ clipboard: copy });
      await press(page, 'Code erzeugen');
      await press(page, 'Adresse kopieren');
      expect(copy).toHaveBeenCalledWith('https://smart.example.org');
      expect(page.snackbar.show).toHaveBeenCalledWith('Adresse kopiert');
    });

    it('offers no copy button without the clipboard API', async () => {
      const page = await open({ clipboard: null });
      await press(page, 'Code erzeugen');
      expect(pageButton(page.element, 'Adresse kopieren')).toBeUndefined();
      expect(text(page)).toContain('https://smart.example.org');
    });

    it('asks for the gateways every 5 seconds while the code is valid and ends on a new one', async () => {
      const page = await open();
      vi.useFakeTimers({ now: NOW });
      await press(page, 'Code erzeugen');
      const loads = listCalls(page).length;
      await wait(page, 5000);
      await wait(page, 5000);
      expect(listCalls(page).length).toBe(loads + 2);
      expect(text(page)).not.toContain('Verbunden');
      page.server.gateways = [
        ...page.server.gateways,
        gateway('gw-cccccccc', 'Zuhause', { lastMessageAt: null }),
      ];
      await wait(page, 5000);
      expect(text(page)).toContain('Verbunden: Zuhause');
      expect(text(page)).not.toContain('AB3D-EF9H');
      const after = listCalls(page).length;
      await wait(page, 20_000);
      expect(listCalls(page).length).toBe(after);
    });

    it('does not take a gateway that existed before the code for the new one', async () => {
      const page = await open();
      vi.useFakeTimers({ now: NOW });
      await press(page, 'Code erzeugen');
      page.server.gateways = [flur, { ...wohnung, lastMessageAt: '2026-10-14T12:00:30Z' }];
      await wait(page, 5000);
      expect(text(page)).not.toContain('Verbunden');
      expect(text(page)).toContain('AB3D-EF9H');
    });

    it('shows a notice and offers a new code when the code has expired', async () => {
      const page = await open();
      vi.useFakeTimers({ now: NOW });
      await press(page, 'Code erzeugen');
      await wait(page, 15 * 60_000 + 5000);
      expect(text(page)).toContain('Der Code ist abgelaufen.');
      expect(text(page)).not.toContain('AB3D-EF9H');
      expect(pageButton(page.element, 'Neuen Code erzeugen')).toBeTruthy();
      const loads = listCalls(page).length;
      await wait(page, 20_000);
      expect(listCalls(page).length).toBe(loads);
      await press(page, 'Neuen Code erzeugen');
      expect(pairings(page)).toHaveLength(2);
      expect(text(page)).toContain('AB3D-EF9H');
    });

    it('says how to add the integration, not how to remove it', async () => {
      const page = await open();
      await press(page, 'Code erzeugen');
      const shown = text(page);
      expect(shown).toContain('füge die Integration „Smart Home“ hinzu');
      expect(shown).not.toContain('Erneut authentifizieren');
      expect(shown).not.toContain('entferne');
    });

    it('says when pairing is not set up on this instance', async () => {
      const page = await open({
        fail: (call) =>
          call.method === 'POST' ? apiError('gateway.pairingUnavailable', 503) : undefined,
      });
      await press(page, 'Code erzeugen');
      expect(page.snackbar.show).toHaveBeenCalledWith(
        'Die Kopplung ist auf dieser Instanz noch nicht eingerichtet.',
        expect.anything(),
      );
      expect(text(page)).not.toContain('Gültig bis');
    });

    it('shows the limit as a message and no code', async () => {
      const page = await open({
        fail: (call) =>
          call.method === 'POST' ? apiError('gateway.limitReached', 409) : undefined,
      });
      await press(page, 'Code erzeugen');
      expect(page.snackbar.show).toHaveBeenCalledWith(
        'Dieser Haushalt hat schon die höchste Zahl an Home-Assistant-Kopplungen.',
        expect.anything(),
      );
      expect(text(page)).not.toContain('Gültig bis');
    });
  });

  describe('re-pairing', () => {
    it('shows the entry as paired and offers re-pairing and revoking to the owner', async () => {
      const page = await open();
      const shown = text(page);
      expect(shown).toContain('Gekoppelt über Home Assistant');
      expect(pageButton(page.element, 'Neu koppeln')).toBeTruthy();
      expect(pageButton(page.element, 'Sperren')).toBeTruthy();
    });

    it('creates a code bound to that gateway', async () => {
      const page = await open();
      await press(page, 'Neu koppeln');
      expect(pairings(page)).toEqual([
        { method: 'POST', path: `${base}/gateway-pairings`, body: { gatewayId: 'gw-bbbbbbbb' } },
      ]);
      expect(text(page)).toContain('AB3D-EF9H');
    });

    it('says to remove the integration in Home Assistant and add it again, or to re-authenticate', async () => {
      const page = await open();
      await press(page, 'Neu koppeln');
      const shown = text(page);
      expect(shown).toContain('Geräte & Dienste');
      expect(shown).toContain('entferne den Eintrag');
      expect(shown).toContain('Geräte und Messwerte in dieser App bleiben erhalten');
      expect(shown).toContain('Füge die Integration „Smart Home“ wieder hinzu');
      expect(shown).toContain('„Erneut authentifizieren“');
      // HACS has the integration already, and a second entry would only be refused.
      expect(shown).not.toContain('HACS');
      expect(link(page, 'In Home Assistant öffnen')).toBeUndefined();
      expect(link(page, 'Integration in Home Assistant neu hinzufügen')!.getAttribute('href')).toBe(
        'https://my.home-assistant.io/redirect/config_flow_start/?domain=smart_bridge',
      );
    });

    it('says the same in English', async () => {
      const page = await open({ language: 'en' });
      await press(page, 'Pair again');
      const shown = text(page);
      expect(shown).toContain('remove the entry');
      expect(shown).toContain('Devices and readings in this app are kept');
      expect(shown).toContain('Add the “Smart Home” integration again');
      expect(shown).toContain('re-authenticate');
      expect(link(page, 'Add the integration in Home Assistant again')).toBeTruthy();
    });

    it('ignores messages on the old key and reports it as connected when the generation goes up', async () => {
      const page = await open();
      vi.useFakeTimers({ now: NOW });
      await press(page, 'Neu koppeln');
      // The gateway is still online with its old key: that is not the pairing.
      page.server.gateways = [flur, { ...wohnung, lastMessageAt: '2026-10-14T12:01:00Z' }];
      await wait(page, 5000);
      expect(text(page)).not.toContain('Verbunden');
      expect(text(page)).toContain('AB3D-EF9H');
      page.server.gateways = [flur, { ...wohnung, credentialGeneration: 2 }];
      await wait(page, 5000);
      expect(text(page)).toContain('Verbunden: Wohnung');
      expect(text(page)).not.toContain('AB3D-EF9H');
    });
  });
});
