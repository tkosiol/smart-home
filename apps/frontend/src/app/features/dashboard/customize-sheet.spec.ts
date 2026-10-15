import { TestBed } from '@angular/core/testing';
import type { Language } from '@smart/contracts';
import { UiAnnouncer, UiBottomSheet } from '@smart/ui';
import { setupPage } from '../../testing/page-testing';
import { CustomizeSheet, type CustomizeData, type CustomizeResult } from './customize-sheet';

const DATA: CustomizeData = {
  blocks: [
    {
      id: 'status',
      labelKey: 'app.overview.blocks.status.label',
      descriptionKey: 'app.overview.blocks.status.description',
      icon: 'notifications',
      visible: true,
    },
    {
      id: 'devices',
      labelKey: 'app.overview.blocks.devices.label',
      descriptionKey: 'app.overview.blocks.devices.description',
      icon: 'devices',
      visible: true,
    },
    {
      id: 'gateway',
      labelKey: 'app.overview.blocks.gateway.label',
      descriptionKey: 'app.overview.blocks.gateway.description',
      icon: 'router',
      visible: false,
    },
  ],
};

/** Opens the sheet with the real `UiBottomSheet`; the result resolves when it closes. */
async function openSheet(language: Language = 'de') {
  await setupPage([], language, [
    { provide: UiAnnouncer, useValue: { announce: vi.fn().mockResolvedValue(undefined) } },
  ]);
  const result = TestBed.inject(UiBottomSheet).open<CustomizeSheet, CustomizeData, CustomizeResult>(
    CustomizeSheet,
    DATA,
  );
  // The sheet host and the texts of the sheet load lazily.
  await vi.waitFor(() => {
    TestBed.tick();
    expect(dialog()?.querySelector('ui-status-entry')).toBeDefined();
    expect(dialog()?.textContent).toContain(language === 'de' ? 'Fertig' : 'Done');
  });
  return { result };
}

const dialog = () => document.querySelector<HTMLDialogElement>('ui-sheet-host dialog');
const switches = () => [...dialog()!.querySelectorAll<HTMLButtonElement>('button[role="switch"]')];
const handles = () => [...dialog()!.querySelectorAll<HTMLButtonElement>('.handle button')];
const names = () =>
  [...dialog()!.querySelectorAll('ui-status-entry .title')].map((title) =>
    title.textContent?.trim(),
  );
const buttonNamed = (name: string) =>
  [...dialog()!.querySelectorAll<HTMLButtonElement>('button')].find(
    (button) => button.textContent?.trim() === name,
  )!;
const tick = async () => {
  TestBed.tick();
  await new Promise((resolve) => setTimeout(resolve));
  TestBed.tick();
};

describe('customise sheet', () => {
  afterEach(() => {
    document.querySelectorAll('ui-sheet-host, .ui-announcer').forEach((node) => node.remove());
    document.documentElement.setAttribute('lang', 'de');
  });

  it('lists the blocks with name, description, a labelled handle and a switch', async () => {
    await openSheet();
    await vi.waitFor(() => {
      TestBed.tick();
      expect(names()).toEqual(['Status', 'Geräte', 'Gateway']);
    });
    expect(dialog()!.querySelector('h2')?.textContent?.trim()).toBe('Übersicht anpassen');
    expect(dialog()!.textContent).toContain('Alle Geräte mit ihrem aktuellen Wert.');
    expect(handles().map((handle) => handle.getAttribute('aria-label'))).toEqual([
      'Status verschieben',
      'Geräte verschieben',
      'Gateway verschieben',
    ]);
    expect(switches().map((toggle) => toggle.getAttribute('aria-checked'))).toEqual([
      'true',
      'true',
      'false',
    ]);
  });

  it('hands back the new order and visibility on "Fertig"', async () => {
    const { result } = await openSheet();
    await vi.waitFor(() => expect(names()).toHaveLength(3));
    switches()[0]!.click(); // hide status
    switches()[2]!.click(); // show gateway
    await tick();
    // Status down one place with the keyboard on its handle.
    handles()[0]!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
    );
    await tick();
    expect(names()).toEqual(['Geräte', 'Status', 'Gateway']);

    buttonNamed('Fertig').click();
    await expect(result).resolves.toEqual({
      kind: 'save',
      layout: {
        blocks: [
          { id: 'devices', visible: true },
          { id: 'status', visible: false },
          { id: 'gateway', visible: true },
        ],
      },
    });
    expect(dialog()).toBeNull();
  });

  it('hands back the unchanged layout on "Fertig" without edits', async () => {
    const { result } = await openSheet();
    await vi.waitFor(() => expect(names()).toHaveLength(3));
    buttonNamed('Fertig').click();
    await expect(result).resolves.toEqual({
      kind: 'save',
      layout: {
        blocks: [
          { id: 'status', visible: true },
          { id: 'devices', visible: true },
          { id: 'gateway', visible: false },
        ],
      },
    });
  });

  it('asks to reset on "Zurücksetzen"', async () => {
    const { result } = await openSheet();
    await vi.waitFor(() => expect(names()).toHaveLength(3));
    buttonNamed('Zurücksetzen').click();
    await expect(result).resolves.toEqual({ kind: 'reset' });
  });

  it('discards the changes when it is closed without "Fertig"', async () => {
    const { result } = await openSheet();
    await vi.waitFor(() => expect(names()).toHaveLength(3));
    switches()[0]!.click();
    await tick();
    dialog()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await expect(result).resolves.toBeUndefined();
    expect(dialog()).toBeNull();
  });

  it('speaks English', async () => {
    await openSheet('en');
    await vi.waitFor(() => {
      TestBed.tick();
      expect(dialog()!.textContent).toContain('Done');
    });
    expect(dialog()!.querySelector('h2')?.textContent?.trim()).toBe('Customise overview');
    expect(handles()[1]!.getAttribute('aria-label')).toBe('Move Devices');
  });
});
