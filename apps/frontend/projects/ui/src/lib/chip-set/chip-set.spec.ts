import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { UiOption } from '../option';
import { UiChipSet } from './chip-set';

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
