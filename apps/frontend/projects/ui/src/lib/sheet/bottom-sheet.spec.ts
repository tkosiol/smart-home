import { BreakpointObserver } from '@angular/cdk/layout';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { NavigationStart, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { MEDIUM } from '../adaptive-shell/adaptive-shell';
import { UiAnnouncer } from '../announcer/announcer';
import { UiButton } from '../button/button';
import { UiBottomSheet } from './bottom-sheet';
import { UiSheet, UiSheetActions } from './sheet';
import { UI_SHEET_DATA, UiSheetRef } from './sheet-ref';

interface Data {
  readonly name: string;
}

@Component({
  imports: [UiSheet, UiSheetActions, UiButton],
  template: `<ui-sheet heading="Übersicht anpassen" description="Blöcke sortieren">
    <p class="body">{{ data.name }}</p>
    <div uiSheetActions>
      <ui-button variant="text" (pressed)="ref.close()">Abbrechen</ui-button>
      <ui-button (pressed)="ref.close('saved')">Fertig</ui-button>
    </div>
  </ui-sheet>`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class Content {
  protected readonly data = inject<Data>(UI_SHEET_DATA);
  protected readonly ref = inject<UiSheetRef<'saved'>>(UiSheetRef);
}

function setup(medium: boolean, router?: { events: Subject<unknown> }) {
  TestBed.configureTestingModule({
    providers: [
      ...(router ? [{ provide: Router, useValue: router }] : []),
      { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      {
        provide: BreakpointObserver,
        useValue: { isMatched: (query: string) => medium && query === MEDIUM },
      },
    ],
  });
  return TestBed.inject(UiBottomSheet);
}

const dialog = () => document.querySelector<HTMLDialogElement>('ui-sheet-host dialog');

/** Waits for the lazily loaded host to open and render its content. */
async function settle(): Promise<HTMLDialogElement> {
  await vi.waitFor(() => expect(dialog()?.hasAttribute('open')).toBe(true));
  TestBed.tick();
  await new Promise((resolve) => setTimeout(resolve));
  TestBed.tick();
  return dialog()!;
}

const buttonNamed = (name: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('ui-sheet-host button')].find(
    (button) => button.textContent?.trim() === name,
  )!;

describe('UiBottomSheet', () => {
  // The host loads with import() on first use; loading it here keeps that cold load out of
  // vi.waitFor's budget.
  beforeAll(async () => {
    await import('./sheet-host');
  }, 30_000);

  afterEach(() => {
    document.querySelectorAll('ui-sheet-host, .ui-announcer').forEach((node) => node.remove());
  });

  it('opens a bottom sheet on compact windows with the data and a drag handle', async () => {
    const sheet = setup(false);
    const result = sheet.open<Content, Data, 'saved'>(Content, { name: 'Status' });
    const element = await settle();
    expect(element.getAttribute('data-presentation')).toBe('sheet');
    expect(element.querySelector('.body')?.textContent).toBe('Status');
    expect(element.querySelector('.handle')).not.toBeNull();
    expect(element.querySelector('h2')?.textContent).toBe('Übersicht anpassen');
    expect(element.getAttribute('aria-labelledby')).toBe(element.querySelector('h2')?.id);
    buttonNamed('Fertig').click();
    await expect(result).resolves.toBe('saved');
    expect(dialog()).toBeNull();
  });

  it('opens a dialog from medium windows up, without a drag handle', async () => {
    const sheet = setup(true);
    const result = sheet.open<Content, Data, 'saved'>(Content, { name: 'Status' });
    const element = await settle();
    expect(element.getAttribute('data-presentation')).toBe('dialog');
    expect(element.querySelector('.body')?.textContent).toBe('Status');
    expect(element.querySelector('.handle')).toBeNull();
    expect(element.getAttribute('aria-labelledby')).toBe(element.querySelector('h2')?.id);
    buttonNamed('Fertig').click();
    await expect(result).resolves.toBe('saved');
  });

  it('resolves undefined when the sheet is closed with Escape', async () => {
    const sheet = setup(false);
    const result = sheet.open<Content, Data, 'saved'>(Content, { name: 'Status' });
    const element = await settle();
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await expect(result).resolves.toBeUndefined();
    expect(dialog()).toBeNull();
  });

  it('resolves undefined when the dialog is closed with Escape', async () => {
    const sheet = setup(true);
    const result = sheet.open<Content, Data, 'saved'>(Content, { name: 'Status' });
    const element = await settle();
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await expect(result).resolves.toBeUndefined();
  });

  it('resolves undefined when the content closes without a result', async () => {
    const sheet = setup(false);
    const result = sheet.open<Content, Data, 'saved'>(Content, { name: 'Status' });
    await settle();
    buttonNamed('Abbrechen').click();
    await expect(result).resolves.toBeUndefined();
  });

  it('closes on a click on the backdrop, not on the content', async () => {
    const sheet = setup(false);
    const result = sheet.open<Content, Data, 'saved'>(Content, { name: 'Status' });
    const element = await settle();
    element.querySelector<HTMLElement>('.body')!.click();
    expect(dialog()).not.toBeNull();
    element.click();
    await expect(result).resolves.toBeUndefined();
  });

  it('announces inside the open dialog, where the inert page cannot be heard', async () => {
    const sheet = setup(false);
    void sheet.open<Content, Data, 'saved'>(Content, { name: 'Status' });
    const element = await settle();
    await TestBed.inject(UiAnnouncer).announce('Status an Position 2 von 3');
    const region = document.querySelector('.ui-announcer')!;
    expect(element.contains(region)).toBe(true);
    expect(region.textContent).toBe('Status an Position 2 von 3');
  });

  it('closes on a navigation and resolves undefined', async () => {
    const events = new Subject<unknown>();
    const sheet = setup(false, { events });
    const result = sheet.open<Content, Data, 'saved'>(Content, { name: 'Status' });
    await settle();
    events.next(new NavigationStart(1, '/geraete'));
    await expect(result).resolves.toBeUndefined();
    expect(dialog()).toBeNull();
  });

  it('leaves no router subscription behind once a sheet has closed', async () => {
    const events = new Subject<unknown>();
    const sheet = setup(false, { events });
    for (let round = 0; round < 3; round++) {
      const result = sheet.open<Content, Data, 'saved'>(Content, { name: 'Status' });
      await settle();
      expect(events.observed).toBe(true);
      buttonNamed('Abbrechen').click();
      await result;
      expect(events.observed).toBe(false);
    }
  });

  it('returns the pending promise for a second open and stacks no second dialog', async () => {
    const sheet = setup(false);
    const first = sheet.open<Content, Data, 'saved'>(Content, { name: 'Status' });
    const second = sheet.open<Content, Data, 'saved'>(Content, { name: 'Anderes' });
    expect(second).toBe(first);
    await settle();
    expect(sheet.open<Content, Data, 'saved'>(Content, { name: 'Drittes' })).toBe(first);
    expect(document.querySelectorAll('ui-sheet-host')).toHaveLength(1);
    expect(document.querySelector('.body')?.textContent).toBe('Status');
    buttonNamed('Fertig').click();
    await expect(first).resolves.toBe('saved');
    const again = sheet.open<Content, Data, 'saved'>(Content, { name: 'Neu' });
    expect(again).not.toBe(first);
    await settle();
    buttonNamed('Abbrechen').click();
    await expect(again).resolves.toBeUndefined();
  });
});
