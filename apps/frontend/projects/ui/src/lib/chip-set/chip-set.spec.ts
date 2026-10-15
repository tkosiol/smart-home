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
    { value: 'bath', label: 'Bad' },
    { value: 'office', label: 'Büro' },
  ];
  readonly selected = signal<readonly Room[]>(['bath']);
  readonly multiple = signal(true);
  readonly disabled = signal(false);
}

function options(fixture: { nativeElement: HTMLElement }) {
  return [...fixture.nativeElement.querySelectorAll('[role="option"]')] as HTMLElement[];
}

describe('UiChipSet', () => {
  it('is a named listbox reflecting the bound selection', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="listbox"]').getAttribute('aria-label')).toBe(
      'Räume',
    );
    expect(options(fixture).map((o) => o.getAttribute('aria-selected'))).toEqual([
      'false',
      'true',
      'false',
    ]);
  });

  it('adds and removes values in multiple mode', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    options(fixture)[0]!.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.selected()).toEqual(['kitchen', 'bath']);
    options(fixture)[1]!.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.selected()).toEqual(['kitchen']);
  });

  it('keeps at most one value in single mode', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.multiple.set(false);
    fixture.detectChanges();
    options(fixture)[2]!.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.selected()).toEqual(['office']);
  });

  it('keeps the selection when disabled', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.disabled.set(true);
    fixture.detectChanges();
    expect(
      options(fixture).every((option) => option.getAttribute('aria-disabled') === 'true'),
    ).toBe(true);
    options(fixture)[0]!.click();
    fixture.detectChanges();
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
