import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { UiSwitch } from './switch';

@Component({
  imports: [UiSwitch],
  template: `<ui-switch label="Benachrichtigungen" [(checked)]="on" [disabled]="disabled()" />`,
})
class Host {
  readonly on = signal(false);
  readonly disabled = signal(false);
}

function render() {
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  const control = fixture.nativeElement.querySelector('button[role="switch"]') as HTMLButtonElement;
  return { fixture, control, host: fixture.componentInstance };
}

describe('UiSwitch', () => {
  it('is a labelled switch reflecting the bound value', () => {
    const { control } = render();
    expect(control.getAttribute('aria-checked')).toBe('false');
    expect(
      control.getAttribute('aria-labelledby') ?? control.getAttribute('aria-label'),
    ).toBeTruthy();
  });

  it('writes the new state back to the binding', () => {
    const { fixture, control, host } = render();
    control.click();
    fixture.detectChanges();
    expect(host.on()).toBe(true);
    expect(control.getAttribute('aria-checked')).toBe('true');
  });

  it('does not change when disabled', () => {
    const { fixture, control, host } = render();
    host.disabled.set(true);
    fixture.detectChanges();
    control.click();
    expect(host.on()).toBe(false);
  });
});
