import { Component, input, type Type } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { HouseholdRole, Language, OverviewLayout } from '@smart/contracts';
import { UiBottomSheet } from '@smart/ui';
import { provideFeature, TopBarActions, type OverviewBlock } from '../../core/features';
import { householdOf, json, meWith } from '../../testing/auth-testing';
import {
  flush,
  openHouseholdPage,
  type OpenedHouseholdPage,
  type RecordedCall,
} from '../../testing/household-page-testing';
import { settle, setupPage } from '../../testing/page-testing';
import type { CustomizeData, CustomizeResult } from './customize-sheet';
import { dashboardRoutes } from './dashboard.routes';

const TEXTS: Record<Language, { title: string; heading: string; description: string }> = {
  de: {
    title: 'Übersicht',
    heading: 'Noch nichts zu sehen',
    description: 'Hier erscheinen später Räume, Geräte und Hinweise auf einen Blick.',
  },
  en: {
    title: 'Overview',
    heading: 'Nothing to see yet',
    description: 'Rooms, devices and notices will show up here at a glance later.',
  },
};

describe('dashboard page without blocks', () => {
  afterEach(() => document.documentElement.setAttribute('lang', 'de'));

  it.each(['de', 'en'] as const)('shows its title and empty state in %s', async (language) => {
    const harness = await setupPage(dashboardRoutes, language);
    await harness.navigateByUrl('/');
    await settle(harness);
    const element = harness.routeNativeElement as HTMLElement;

    expect(element.querySelector('h1')?.textContent?.trim()).toBe(TEXTS[language].title);
    expect(element.querySelector('ui-empty-state h2')?.textContent?.trim()).toBe(
      TEXTS[language].heading,
    );
    expect(element.querySelector('ui-empty-state p')?.textContent?.trim()).toBe(
      TEXTS[language].description,
    );
  });
});

@Component({ selector: 'app-test-status', template: 'status visible={{ visible() }}' })
class StatusStub {
  readonly visible = input(true);
}
@Component({ selector: 'app-test-devices', template: 'devices' })
class DevicesStub {}
@Component({ selector: 'app-test-gateway', template: 'gateway' })
class GatewayStub {}
@Component({ selector: 'app-test-rooms', template: 'rooms' })
class RoomsStub {}

const block = (
  id: string,
  component: OverviewBlock['component'],
  overrides: Partial<OverviewBlock> = {},
): OverviewBlock => ({
  id,
  labelKey: `app.overview.blocks.${id}.label`,
  descriptionKey: `app.overview.blocks.${id}.description`,
  icon: 'home',
  defaultVisible: true,
  defaultOrder: 10,
  component,
  ...overrides,
});

const STATUS = block('status', StatusStub, { defaultOrder: 10, surfaceWhenHidden: true });
const DEVICES = block('devices', DevicesStub, { defaultOrder: 20 });
const GATEWAY = block('gateway', GatewayStub, {
  defaultOrder: 30,
  defaultVisible: false,
  minRole: 'owner',
});

interface Options {
  blocks?: OverviewBlock[];
  /** What GET answers; a function can fail. */
  stored?: OverviewLayout | null | ((call: RecordedCall) => Response);
  role?: HouseholdRole;
  /** What PUT answers; the default echoes the body. */
  save?: (call: RecordedCall) => Response;
  /** What the sheet answers, in order; the default is "closed without a result". */
  sheet?: (CustomizeResult | undefined)[];
  language?: Language;
}

async function open({
  blocks = [STATUS, DEVICES, GATEWAY],
  stored = null,
  role = 'owner',
  sheet = [],
  save,
  language = 'de',
}: Options = {}) {
  const openSheet = vi.fn(() => Promise.resolve(sheet.shift()));
  TestBed.configureTestingModule({
    providers: [
      provideFeature({ overviewBlocks: blocks }),
      { provide: UiBottomSheet, useValue: { open: openSheet } },
    ],
  });
  const household = householdOf('Home', { role });
  const layoutPath = `/api/v1/households/${household.id}/me/overview-layout`;
  const page = await openHouseholdPage(
    [{ path: 'uebersicht', loadChildren: () => dashboardRoutes }],
    '/uebersicht',
    {
      language,
      me: meWith([household], household.id),
      respond: (call) => {
        if (call.path !== layoutPath) return new Response(null, { status: 204 });
        if (call.method === 'GET') {
          return typeof stored === 'function' ? stored(call) : json(stored);
        }
        if (call.method === 'PUT') return save ? save(call) : json(call.body);
        return new Response(null, { status: 204 });
      },
    },
  );
  await rendered(page);
  return { ...page, openSheet, layoutPath };
}

/** The blocks load lazily and so do the texts: waits until the page has settled. */
async function rendered(page: OpenedHouseholdPage) {
  await vi.waitFor(async () => {
    await flush(page, 2);
    expect(page.element.querySelector('ui-grid, ui-empty-state')).not.toBeNull();
  });
  await flush(page, 3);
}

/** The sheet's code loads on demand: waits until the page has opened it and handled the answer. */
async function sheetOpened(page: Awaited<ReturnType<typeof open>>) {
  await vi.waitFor(() => expect(page.openSheet).toHaveBeenCalled());
  await flush(page, 6);
}

/** The blocks on the page, in order. */
const shown = (page: OpenedHouseholdPage) =>
  [
    ...page.element.querySelectorAll(
      'app-test-status, app-test-devices, app-test-gateway, app-test-rooms',
    ),
  ].map((element) => element.localName.replace('app-test-', ''));

describe('dashboard page with blocks', () => {
  afterEach(() => document.documentElement.setAttribute('lang', 'de'));

  it('shows the blocks in default order and leaves out the one that is hidden by default', async () => {
    const page = await open();
    expect(shown(page)).toEqual(['status', 'devices']);
    expect(page.element.querySelector('h1')?.textContent?.trim()).toBe('Übersicht');
    expect(page.element.querySelector('ui-empty-state')).toBeNull();
  });

  it('does not load the code of a block that is hidden', async () => {
    const loader = vi.fn(() => Promise.resolve(GatewayStub as Type<unknown>));
    const page = await open({ blocks: [STATUS, DEVICES, { ...GATEWAY, component: loader }] });
    expect(shown(page)).toEqual(['status', 'devices']);
    expect(loader).not.toHaveBeenCalled();
  });

  it('keeps the order and visibility the user stored', async () => {
    const page = await open({
      stored: {
        blocks: [
          { id: 'gateway', visible: true },
          { id: 'devices', visible: true },
          { id: 'status', visible: true },
        ],
      },
    });
    expect(shown(page)).toEqual(['gateway', 'devices', 'status']);
  });

  describe('a stored layout that does not match the registered blocks (review focus 2)', () => {
    it('ignores an unknown block ID', async () => {
      const page = await open({
        stored: {
          blocks: [
            { id: 'moss', visible: true },
            { id: 'devices', visible: true },
            { id: 'status', visible: true },
          ],
        },
      });
      expect(shown(page)).toEqual(['devices', 'status']);
    });

    it('appends a block the layout does not know yet, with its defaults', async () => {
      const page = await open({
        blocks: [STATUS, DEVICES, GATEWAY, block('rooms', RoomsStub, { defaultOrder: 40 })],
        stored: {
          blocks: [
            { id: 'devices', visible: true },
            { id: 'status', visible: true },
          ],
        },
      });
      // `gateway` is new but hidden by default; `rooms` is new and visible.
      expect(shown(page)).toEqual(['devices', 'status', 'rooms']);
    });

    it('shows the defaults when nothing is stored (the server answers null)', async () => {
      const page = await open({ stored: null });
      expect(shown(page)).toEqual(['status', 'devices']);
    });

    it('shows the defaults for an empty list and drops duplicates', async () => {
      const empty = await open({ stored: { blocks: [] } });
      expect(shown(empty)).toEqual(['status', 'devices']);
      TestBed.resetTestingModule();
      const duplicated = await open({
        stored: {
          blocks: [
            { id: 'devices', visible: false },
            { id: 'devices', visible: true },
            { id: 'status', visible: true },
          ],
        },
      });
      expect(shown(duplicated)).toEqual(['status']);
    });

    it('shows the defaults and tells the error when the layout cannot be read', async () => {
      const page = await open({ stored: () => new Response('boom', { status: 500 }) });
      expect(shown(page)).toEqual(['status', 'devices']);
      expect(page.snackbar.show).toHaveBeenCalled();
    });
  });

  it('renders a block that asks for it while it is hidden, with visible false', async () => {
    const page = await open({
      stored: {
        blocks: [
          { id: 'status', visible: false },
          { id: 'devices', visible: true },
        ],
      },
    });
    expect(shown(page)).toEqual(['status', 'devices']);
    expect(page.element.querySelector('app-test-status')?.textContent).toBe('status visible=false');
  });

  it('does not render a hidden block that does not ask for it', async () => {
    const page = await open({
      stored: {
        blocks: [
          { id: 'status', visible: true },
          { id: 'devices', visible: false },
        ],
      },
    });
    expect(shown(page)).toEqual(['status']);
    expect(page.element.querySelector('app-test-status')?.textContent).toBe('status visible=true');
  });

  it('leaves out blocks above the role of the user', async () => {
    const page = await open({
      role: 'member',
      stored: {
        blocks: [
          { id: 'gateway', visible: true },
          { id: 'devices', visible: true },
        ],
      },
    });
    expect(shown(page)).toEqual(['devices', 'status']);
  });

  it('drops only the block whose loader fails', async () => {
    const page = await open({
      blocks: [{ ...STATUS, component: () => Promise.reject(new Error('chunk lost')) }, DEVICES],
    });
    expect(shown(page)).toEqual(['devices']);
  });

  it('says so when the user hid every block', async () => {
    const page = await open({
      blocks: [DEVICES],
      stored: { blocks: [{ id: 'devices', visible: false }] },
    });
    expect(shown(page)).toEqual([]);
    expect(page.element.querySelector('ui-empty-state h2')?.textContent?.trim()).toBe(
      'Alles ausgeblendet',
    );
  });

  it('reads the layout of the current household', async () => {
    const page = await open();
    const reads = page.calls.filter(
      (call) => call.method === 'GET' && call.path === page.layoutPath,
    );
    expect(reads).toHaveLength(1);
  });
});

describe('the customise icon in the top bar', () => {
  it('is added while the page is shown and taken away with it', async () => {
    const page = await open();
    const bar = TestBed.inject(TopBarActions);
    expect(bar.action()).toMatchObject({
      id: 'overview-customize',
      icon: 'tune',
      labelKey: 'app.overview.customize',
    });
    await page.router.navigateByUrl('/nirgends');
    await flush(page);
    expect(bar.action()).toBeNull();
  });

  it('opens the sheet with the blocks in layout order, and saves on "Fertig"', async () => {
    const saved: OverviewLayout = {
      blocks: [
        { id: 'devices', visible: true },
        { id: 'status', visible: false },
        { id: 'gateway', visible: true },
      ],
    };
    const page = await open({ sheet: [{ kind: 'save', layout: saved }] });
    TestBed.inject(TopBarActions).action()?.run();
    await sheetOpened(page);

    const [component, data] = page.openSheet.mock.calls[0] as unknown as [unknown, CustomizeData];
    expect(component).toBeDefined();
    expect(data.blocks.map((entry) => [entry.id, entry.visible, entry.labelKey])).toEqual([
      ['status', true, 'app.overview.blocks.status.label'],
      ['devices', true, 'app.overview.blocks.devices.label'],
      ['gateway', false, 'app.overview.blocks.gateway.label'],
    ]);
    const put = page.calls.find((call) => call.method === 'PUT');
    expect(put).toMatchObject({ path: page.layoutPath, body: saved });
    // The page follows what was saved: the new order, `status` hidden but still asked to surface.
    expect(shown(page)).toEqual(['devices', 'status', 'gateway']);
    expect(page.element.querySelector('app-test-status')?.textContent).toBe('status visible=false');
  });

  it('deletes the stored layout on "Zurücksetzen" and shows the defaults', async () => {
    const page = await open({
      stored: {
        blocks: [
          { id: 'devices', visible: true },
          { id: 'status', visible: false },
        ],
      },
      sheet: [{ kind: 'reset' }],
    });
    expect(shown(page)).toEqual(['devices', 'status']);
    TestBed.inject(TopBarActions).action()?.run();
    await sheetOpened(page);

    expect(page.calls.filter((call) => call.method === 'DELETE')).toHaveLength(1);
    expect(page.calls.some((call) => call.method === 'PUT')).toBe(false);
    expect(shown(page)).toEqual(['status', 'devices']);
    expect(page.element.querySelector('app-test-status')?.textContent).toBe('status visible=true');
  });

  it('changes and saves nothing when the sheet is closed without a result', async () => {
    const page = await open({ sheet: [undefined] });
    TestBed.inject(TopBarActions).action()?.run();
    await sheetOpened(page);

    expect(page.openSheet).toHaveBeenCalledTimes(1);
    expect(page.calls.some((call) => call.method === 'PUT' || call.method === 'DELETE')).toBe(
      false,
    );
    expect(shown(page)).toEqual(['status', 'devices']);
  });

  it('keeps the page and tells the error when saving fails', async () => {
    const page = await open({
      sheet: [{ kind: 'save', layout: { blocks: [{ id: 'devices', visible: true }] } }],
      save: () => new Response('boom', { status: 500 }),
    });
    TestBed.inject(TopBarActions).action()?.run();
    await sheetOpened(page);

    expect(page.snackbar.show).toHaveBeenCalled();
    expect(shown(page)).toEqual(['status', 'devices']);
  });
});
