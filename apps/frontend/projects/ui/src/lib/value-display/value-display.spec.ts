import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { UiToneName } from '../tone';
import { UiValueDisplay, type UiValueDisplaySize } from './value-display';

@Component({
  imports: [UiValueDisplay],
  template: `<ui-value-display
    [value]="value()"
    [unit]="unit()"
    [label]="label()"
    [size]="size()"
    [tone]="tone()"
  />`,
})
class Host {
  readonly value = signal('21,8');
  readonly unit = signal<string | undefined>('°C');
  readonly label = signal<string | undefined>('Temperatur');
  readonly size = signal<UiValueDisplaySize>('medium');
  readonly tone = signal<UiToneName | undefined>(undefined);
}

function render() {
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  return fixture;
}

function host(fixture: { nativeElement: HTMLElement }): HTMLElement {
  return fixture.nativeElement.querySelector('ui-value-display')!;
}

describe('UiValueDisplay', () => {
  it('shows value, unit and label as plain text', () => {
    const fixture = render();
    const element = host(fixture);
    expect(element.querySelector('.value')?.textContent).toBe('21,8');
    expect(element.querySelector('.unit')?.textContent).toBe('°C');
    expect(element.querySelector('.label')?.textContent).toBe('Temperatur');
    expect(element.querySelector('h1, h2, h3, h4, h5, h6')).toBeNull();
  });

  it('leaves unit and label out when they are not given', () => {
    const fixture = render();
    fixture.componentInstance.unit.set(undefined);
    fixture.componentInstance.label.set(undefined);
    fixture.detectChanges();
    const element = host(fixture);
    expect(element.querySelector('.unit')).toBeNull();
    expect(element.querySelector('.label')).toBeNull();
    expect(element.textContent?.trim()).toBe('21,8');
  });

  it('exposes size and tone for the styles', () => {
    const fixture = render();
    expect(host(fixture).getAttribute('data-size')).toBe('medium');
    expect(host(fixture).hasAttribute('data-tone')).toBe(false);
    fixture.componentInstance.size.set('hero');
    fixture.componentInstance.tone.set('dry');
    fixture.detectChanges();
    expect(host(fixture).getAttribute('data-size')).toBe('hero');
    expect(host(fixture).getAttribute('data-tone')).toBe('dry');
  });
});
