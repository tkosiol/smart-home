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

  it('shows status and last message of each gateway and leaves out revoked ones', async () => {
    const page = await open([
      gateway('gw-aaaaaaaa', 'Flur'),
      gateway('gw-bbbbbbbb', 'Keller', { bridgeStatus: 'offline', lastMessageAt: null }),
      gateway('gw-cccccccc', 'Alt', { revokedAt: '2026-10-01T00:00:00Z' }),
    ]);
    await shown(page, 'Flur');
    const text = pageText(page.element);
    expect(text).toContain('Bridge: Online');
    expect(text).toContain('Zigbee2MQTT: Online');
    expect(text).toContain('Letzte Nachricht vor 3 Minuten');
    expect(text).toContain('Keller');
    expect(text).toContain('Bridge: Offline');
    expect(text).toContain('Noch keine Nachricht empfangen');
    expect(text).not.toContain('Alt');
  });

  it('says so when no gateway is registered', async () => {
    const page = await open([]);
    await shown(page, 'Noch kein Gateway registriert.');
  });
});
