import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { UiOption } from '../option';
import { UiChipSet, type UiChipOption } from './chip-set';

type Room = 'kitchen' | 'bath' | 'office';

@Component({
  imports: [UiChipSet],
  template: `<ui-chip-set
    label="Räume"
    [options]="options"
    [multiple]="multiple()"
    [(selected)]="selected"
    [disabled]="disabled()"
  />`,
})
class Host {
  readonly options: readonly UiOption<Room>[] = [
    { value: 'kitchen', label: 'Küche' },
    { value: 'bath', label: 'Bad', icon: 'water_drop' },
    { value: 'office', label: 'Büro' },
  ];
  readonly selected = signal<readonly Room[]>(['bath']);
  readonly multiple = signal(true);
  readonly disabled = signal(false);
}

function options(fixture: { nativeElement: HTMLElement }) {
  return [...fixture.nativeElement.querySelectorAll('[role="option"]')] as HTMLButtonElement[];
}

function press(target: HTMLElement, key: string): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

describe('UiChipSet', () => {
  it('is a named listbox of native buttons reflecting the bound selection', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const listbox = fixture.nativeElement.querySelector('[role="listbox"]') as HTMLElement;
    expect(listbox.getAttribute('aria-label')).toBe('Räume');
    expect(listbox.getAttribute('aria-multiselectable')).toBe('true');
    expect(listbox.getAttribute('aria-orientation')).toBe('horizontal');
    expect(fixture.nativeElement.querySelector('[class*="mat-"], [class*="mdc-"]')).toBeNull();
    expect(options(fixture).every((option) => option.tagName === 'BUTTON')).toBe(true);
    expect(options(fixture).map((o) => o.getAttribute('aria-selected'))).toEqual([
      'false',
      'true',
      'false',
    ]);
  });

  it('shows a check mark on a selected chip instead of its icon', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const [kitchen, bath] = options(fixture);
    expect(kitchen!.querySelector('ui-icon')).toBeNull();
    expect(bath!.querySelector('ui-icon')?.textContent).toBe(String.fromCodePoint(0xe5ca));
    fixture.componentInstance.selected.set([]);
    fixture.detectChanges();
    expect(bath!.querySelector('ui-icon')?.textContent).toBe(String.fromCodePoint(0xe798));
  });

  it('adds and removes values in multiple mode', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    options(fixture)[0]!.click();
    fixture.detectChanges();
    // The selection is written in the order of the options, not of the clicks.
    expect(fixture.componentInstance.selected()).toEqual(['kitchen', 'bath']);
    options(fixture)[1]!.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.selected()).toEqual(['kitchen']);
  });

  it('keeps at most one value in single mode', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.multiple.set(false);
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('[role="listbox"]').getAttribute('aria-multiselectable'),
    ).toBe('false');
    options(fixture)[2]!.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.selected()).toEqual(['office']);
    // The chosen chip stays chosen (a single choice cannot be emptied).
    options(fixture)[2]!.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.selected()).toEqual(['office']);
  });

  it('keeps the selection when disabled', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.disabled.set(true);
    fixture.detectChanges();
    expect(options(fixture).every((option) => option.disabled)).toBe(true);
    options(fixture)[0]!.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.selected()).toEqual(['bath']);
  });

  it('puts only the first selected chip in the tab order', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    expect(options(fixture).map((option) => option.tabIndex)).toEqual([-1, 0, -1]);
    fixture.componentInstance.selected.set([]);
    fixture.detectChanges();
    expect(options(fixture).map((option) => option.tabIndex)).toEqual([0, -1, -1]);
  });

  it('moves the focus with the arrow keys without changing the selection', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const [kitchen, bath, office] = options(fixture) as [
      HTMLButtonElement,
      HTMLButtonElement,
      HTMLButtonElement,
    ];
    bath.focus();
    press(bath, 'ArrowRight');
    fixture.detectChanges();
    expect(document.activeElement).toBe(office);
    expect(options(fixture).map((option) => option.tabIndex)).toEqual([-1, -1, 0]);
    press(office, 'ArrowRight');
    fixture.detectChanges();
    expect(document.activeElement).toBe(kitchen);
    press(kitchen, 'ArrowLeft');
    fixture.detectChanges();
    expect(document.activeElement).toBe(office);
    press(office, 'Home');
    fixture.detectChanges();
    expect(document.activeElement).toBe(kitchen);
    press(kitchen, 'End');
    fixture.detectChanges();
    expect(document.activeElement).toBe(office);
    expect(fixture.componentInstance.selected()).toEqual(['bath']);
  });
});

type Severity = 'all' | 'critical' | 'warning' | 'info';

@Component({
  imports: [UiChipSet],
  template: `<ui-chip-set
    label="Nach Dringlichkeit filtern"
    [options]="options()"
    [(selected)]="selected"
  />`,
})
class CountHost {
  readonly options = signal<readonly UiChipOption<Severity>[]>([
    { value: 'all', label: 'Alle', count: 20 },
    { value: 'critical', label: 'Kritisch', count: 0 },
    { value: 'info', label: 'Hinweis' },
  ]);
  readonly selected = signal<readonly Severity[]>(['all']);
}

describe('UiChipSet counts', () => {
  // The accessible name "Alle 20" (label, separator, count) is checked in the story: jsdom has no
  // layout, and the separator comes from the count being an inline-block.
  it('shows a count after the label, including zero', () => {
    const fixture = TestBed.createComponent(CountHost);
    fixture.detectChanges();
    const chips = options(fixture);
    expect(chips[0]!.querySelector('.label')?.textContent).toBe('Alle');
    expect(chips[0]!.querySelector('.count')?.textContent?.trim()).toBe('20');
    expect(chips[1]!.querySelector('.count')?.textContent?.trim()).toBe('0');
    expect(chips[2]!.querySelector('.count')).toBeNull();
  });

  it('updates the count when the options change', () => {
    const fixture = TestBed.createComponent(CountHost);
    fixture.detectChanges();
    fixture.componentInstance.options.set([{ value: 'all', label: 'Alle', count: 3 }]);
    fixture.detectChanges();
    expect(options(fixture)[0]!.querySelector('.count')?.textContent?.trim()).toBe('3');
  });
});
