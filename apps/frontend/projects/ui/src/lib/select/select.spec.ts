import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import type { UiOption } from '../option';
import { UiSelect } from './select';

type Contrast = 'system' | 'standard' | 'medium' | 'high';

@Component({
  imports: [UiSelect],
  template: `<ui-select
    label="Kontrast"
    hint="Gilt sofort"
    [options]="options"
    [disabled]="disabled()"
    [(value)]="contrast"
  />`,
})
class Host {
  readonly options: readonly UiOption<Contrast>[] = [
    { value: 'system', label: 'System' },
    { value: 'standard', label: 'Standard' },
    { value: 'medium', label: 'Mittel' },
    { value: 'high', label: 'Hoch' },
  ];
  readonly contrast = signal<Contrast>('system');
  readonly disabled = signal(false);
}

function setup() {
  TestBed.configureTestingModule({
    providers: [{ provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } }],
  });
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  const combobox = fixture.nativeElement.querySelector('[role="combobox"]') as HTMLElement;
  return { fixture, combobox };
}

const option = (label: string) =>
  [...document.querySelectorAll('mat-option')].find((element) =>
    element.textContent?.includes(label),
  ) as HTMLElement | undefined;

describe('UiSelect', () => {
  it('labels the field and shows the bound option and the hint', async () => {
    const { fixture, combobox } = setup();
    // The selected option is resolved after the options have rendered.
    await fixture.whenStable();
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('mat-label')?.textContent).toContain('Kontrast');
    expect(combobox.textContent).toContain('System');
    expect(host.querySelector('mat-hint')?.textContent).toContain('Gilt sofort');
  });

  it('writes the chosen option back to the binding', async () => {
    const { fixture, combobox } = setup();
    combobox.click();
    fixture.detectChanges();
    await fixture.whenStable();
    option('Hoch')!.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.contrast()).toBe('high');
    expect(combobox.textContent).toContain('Hoch');
  });

  it('cannot be opened while disabled', () => {
    const { fixture, combobox } = setup();
    fixture.componentInstance.disabled.set(true);
    fixture.detectChanges();
    combobox.click();
    fixture.detectChanges();
    expect(combobox.getAttribute('aria-disabled')).toBe('true');
    expect(option('Hoch')).toBeUndefined();
  });
});
