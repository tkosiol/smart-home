import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { UiAnnouncer } from '../announcer/announcer';
import { provideUiTranslocoTesting } from '../testing/i18n-testing';
import { UiReorderList, UiReorderRow, type UiReorderItem } from './reorder-list';

interface Block extends UiReorderItem {
  readonly title: string;
}

@Component({
  imports: [UiReorderList, UiReorderRow],
  template: `<ui-reorder-list [items]="items()" (reordered)="orders.update((o) => [...o, $event])">
    <ng-template [uiReorderRow]="items()" let-block>
      <span class="name">{{ block.title }}</span>
    </ng-template>
  </ui-reorder-list>`,
})
class Host {
  readonly items = signal<readonly Block[]>([
    { id: 'status', label: 'Status verschieben', name: 'Status', title: 'Status' },
    { id: 'devices', label: 'Geräte verschieben', name: 'Geräte', title: 'Geräte' },
    { id: 'gateway', label: 'Gateway verschieben', title: 'Gateway' },
  ]);
  readonly orders = signal<string[][]>([]);
}

async function render(language: 'de' | 'en' = 'de') {
  const announce = vi.fn().mockResolvedValue(undefined);
  TestBed.configureTestingModule({
    providers: [
      provideUiTranslocoTesting(language),
      { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      { provide: UiAnnouncer, useValue: { announce } },
    ],
  });
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  await fixture.whenStable();
  const element = fixture.nativeElement as HTMLElement;
  const handles = () => [...element.querySelectorAll<HTMLButtonElement>('.handle button')];
  const names = () =>
    [...element.querySelectorAll('.name')].map((name) => name.textContent?.trim());
  const press = (handle: HTMLElement, key: string) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    handle.dispatchEvent(event);
    fixture.detectChanges();
    return event;
  };
  return { fixture, host: fixture.componentInstance, element, handles, names, press, announce };
}

describe('UiReorderList', () => {
  it('renders one row per item with a labelled drag handle', async () => {
    const { element, handles, names } = await render();
    expect(element.querySelector('[role="list"]')).not.toBeNull();
    expect(element.querySelectorAll('[role="listitem"]')).toHaveLength(3);
    expect(names()).toEqual(['Status', 'Geräte', 'Gateway']);
    expect(handles().map((handle) => handle.getAttribute('aria-label'))).toEqual([
      'Status verschieben',
      'Geräte verschieben',
      'Gateway verschieben',
    ]);
  });

  it('moves the focused row down and up with the arrow keys and emits the new order', async () => {
    const { host, handles, names, press, announce } = await render();
    const status = handles()[0]!;
    status.focus();
    const down = press(status, 'ArrowDown');
    expect(down.defaultPrevented).toBe(true);
    expect(names()).toEqual(['Geräte', 'Status', 'Gateway']);
    expect(host.orders()).toEqual([['devices', 'status', 'gateway']]);
    expect(document.activeElement).toBe(status);
    expect(announce).toHaveBeenCalledWith('Status: Position 2 von 3', 'polite');
    press(status, 'ArrowUp');
    expect(names()).toEqual(['Status', 'Geräte', 'Gateway']);
    expect(host.orders()).toEqual([
      ['devices', 'status', 'gateway'],
      ['status', 'devices', 'gateway'],
    ]);
  });

  it('does nothing at the ends and ignores other keys', async () => {
    const { host, handles, names, press } = await render();
    const up = press(handles()[0]!, 'ArrowUp');
    expect(up.defaultPrevented).toBe(false);
    press(handles()[2]!, 'ArrowDown');
    press(handles()[1]!, 'Enter');
    expect(names()).toEqual(['Status', 'Geräte', 'Gateway']);
    expect(host.orders()).toEqual([]);
  });

  it('follows a new order from the host', async () => {
    const { fixture, host, names } = await render();
    host.items.set([...host.items()].reverse());
    fixture.detectChanges();
    expect(names()).toEqual(['Gateway', 'Geräte', 'Status']);
  });

  it('announces moves in English', async () => {
    const { handles, press, announce } = await render('en');
    press(handles()[1]!, 'ArrowDown');
    expect(announce).toHaveBeenCalledWith('Geräte: position 3 of 3', 'polite');
  });

  it('announces only the position of an item without a name', async () => {
    const { handles, press, announce } = await render();
    const gateway = handles()[2]!;
    press(gateway, 'ArrowUp');
    expect(announce).toHaveBeenCalledWith('Position 2 von 3', 'polite');
  });
});
