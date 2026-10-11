import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { UiSegmentedButton, type UiSegmentOption } from './segmented-button';

type Mode = 'system' | 'light' | 'dark';

@Component({
  imports: [UiSegmentedButton],
  template: `<ui-segmented-button label="Modus" [options]="options" [(value)]="mode" />`,
})
class Host {
  readonly options: readonly UiSegmentOption<Mode>[] = [
    { value: 'system', label: 'System' },
    { value: 'light', label: 'Hell', icon: 'light_mode' },
    { value: 'dark', label: 'Dunkel', icon: 'dark_mode' },
  ];
  readonly mode = signal<Mode>('system');
}

describe('UiSegmentedButton', () => {
  it('names the group and marks the bound option as selected', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const group = fixture.nativeElement.querySelector('mat-button-toggle-group') as HTMLElement;
    expect(group.getAttribute('aria-label')).toBe('Modus');
    const checked = fixture.nativeElement.querySelector('[aria-checked="true"]') as HTMLElement;
    expect(checked.textContent).toContain('System');
  });

  it('writes the chosen option back to the binding', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const buttons = fixture.nativeElement.querySelectorAll(
      'button',
    ) as NodeListOf<HTMLButtonElement>;
    buttons[2]!.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.mode()).toBe('dark');
  });
});

@Component({
  imports: [UiSegmentedButton],
  template: `<ui-segmented-button
    label="Modus"
    [options]="options"
    [(value)]="mode"
    [disabled]="true"
  />`,
})
class DisabledHost {
  readonly options: readonly UiSegmentOption<Mode>[] = [
    { value: 'system', label: 'System' },
    { value: 'light', label: 'Hell', icon: 'light_mode' },
    { value: 'dark', label: 'Dunkel', icon: 'dark_mode' },
  ];
  readonly mode = signal<Mode>('system');
}

describe('UiSegmentedButton when disabled', () => {
  it('disables every segment and keeps the value when one is clicked', () => {
    const fixture = TestBed.createComponent(DisabledHost);
    fixture.detectChanges();
    const buttons = fixture.nativeElement.querySelectorAll(
      'button',
    ) as NodeListOf<HTMLButtonElement>;
    expect(buttons.length).toBe(3);
    expect(Array.from(buttons).every((button) => button.disabled)).toBe(true);
    buttons[2]!.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.mode()).toBe('system');
  });
});
