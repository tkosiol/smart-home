import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Gateway } from '@smart/contracts';
import { UiClock } from '@smart/ui';
import {
  injectOverviewBlocks,
  resolveOverviewBlocks,
  usableOverviewBlocks,
} from '../../core/overview-blocks';
import { householdOf, json, meWith } from '../../testing/auth-testing';
import {
  flush,
  openHouseholdPage,
  pageText,
  type OpenedHouseholdPage,
} from '../../testing/household-page-testing';
import { GatewayBlock } from './gateway-block';
import { provideGatewaysFeature } from './gateways-feature';

const home = householdOf('Home', { role: 'owner' });

const gateway = (id: string, name: string, overrides: Partial<Gateway> = {}): Gateway => ({
  id,
  name,
  kind: 'z2m',
  topicPrefix: `smart/gateways/${id}/z2m`,
  bridgeStatus: 'online',
  z2mStatus: 'online',
  statusChangedAt: '2026-10-14T08:00:00Z',
  lastMessageAt: '2026-10-14T11:57:00Z',
  certExpiresAt: '2027-04-01T10:00:00Z',
  revokedAt: null,
  warnings: [],
  ...overrides,
});

@Component({
  selector: 'app-overview-host',
  imports: [GatewayBlock],
  template: '<h1>Übersicht</h1><app-gateway-block />',
})
class Host {}

function open(gateways: Gateway[]) {
  TestBed.overrideProvider(UiClock, {
    useValue: { now: signal(Date.parse('2026-10-14T12:00:00Z')) },
  });
  return openHouseholdPage([{ path: 'uebersicht', component: Host }], '/uebersicht', {
    me: meWith([home], home.id),
    respond: (call) =>
      call.path === `/api/v1/households/${home.id}/gateways`
        ? json(gateways)
        : new Response(null, { status: 204 }),
  });
}

async function shown(page: OpenedHouseholdPage, text: string) {
  await vi.waitFor(async () => {
    await flush(page, 1);
    expect(pageText(page.element)).toContain(text);
  });
}

describe('gateway overview block', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('is registered as a hidden, lazy block for owners', async () => {
    TestBed.configureTestingModule({ providers: [provideGatewaysFeature()] });
    const blocks = TestBed.runInInjectionContext(() => injectOverviewBlocks());
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      id: 'gateway',
      icon: 'router',
      defaultVisible: false,
      minRole: 'owner',
    });
    expect(blocks[0]?.component).not.toBe(GatewayBlock);
    expect((await resolveOverviewBlocks(blocks)).map((entry) => entry.component)).toEqual([
      GatewayBlock,
    ]);
    expect(usableOverviewBlocks(blocks, 'member')).toEqual([]);
    expect(usableOverviewBlocks(blocks, 'owner')).toHaveLength(1);
  });

  it('shows a row per gateway with state and last message and leaves out revoked ones', async () => {
    const page = await open([
      gateway('gw-aaaaaaaa', 'Flur'),
      gateway('gw-bbbbbbbb', 'Keller', { bridgeStatus: 'offline', lastMessageAt: null }),
      gateway('gw-dddddddd', 'Dach', { z2mStatus: 'unknown' }),
      gateway('gw-cccccccc', 'Alt', { revokedAt: '2026-10-01T00:00:00Z' }),
    ]);
    // The texts of the scope arrive after the names: wait for a translated one.
    await shown(page, 'Gateway online · Letzte Nachricht vor 3 Minuten');
    const rows = [...page.element.querySelectorAll('ui-status-entry')] as HTMLElement[];
    expect(rows).toHaveLength(3);
    const [flur, keller, dach] = rows as [HTMLElement, HTMLElement, HTMLElement];
    expect(pageText(flur)).toContain('Flur');
    expect(pageText(flur)).toContain('Gateway online · Letzte Nachricht vor 3 Minuten');
    expect(flur.querySelector('.lead')?.getAttribute('data-tone')).toBe('ok-container');
    expect(flur.querySelector('a')?.getAttribute('href')).toBe('/mehr/gateways');
    expect(pageText(keller)).toContain('Keller');
    expect(pageText(keller)).toContain('Gateway offline · Noch keine Nachricht empfangen');
    expect(keller.querySelector('.lead')?.getAttribute('data-tone')).toBe('error');
    expect(pageText(dach)).toContain('Status unbekannt');
    expect(dach.querySelector('.lead')?.getAttribute('data-tone')).toBe('offline-container');
    expect(pageText(page.element)).not.toContain('Alt');
  });

  it('says so when no gateway is registered', async () => {
    const page = await open([]);
    await shown(page, 'Noch kein Gateway registriert.');
  });

  it('shows a gateway status event: a changed state, a new gateway, a revoked one gone', async () => {
    const page = await open([gateway('gw-aaaaaaaa', 'Flur')]);
    await shown(page, 'Gateway online');
    page.live.emit('gateway.status', gateway('gw-aaaaaaaa', 'Flur', { bridgeStatus: 'offline' }));
    await shown(page, 'Gateway offline');
    page.live.emit('gateway.status', gateway('gw-bbbbbbbb', 'Keller'));
    await shown(page, 'Keller');
    page.live.emit(
      'gateway.status',
      gateway('gw-bbbbbbbb', 'Keller', { revokedAt: '2026-10-14T11:59:00Z' }),
    );
    await flush(page);
    expect(pageText(page.element)).not.toContain('Keller');
  });

  it('loads again after a reconnect, and not every minute any more', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const page = await open([gateway('gw-aaaaaaaa', 'Flur')]);
    const gets = () => page.calls.filter((call) => call.path.endsWith('/gateways'));
    await flush(page);
    expect(gets()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(180_000);
    expect(gets()).toHaveLength(1);
    page.live.resync();
    await flush(page);
    expect(gets()).toHaveLength(2);
  });
});
