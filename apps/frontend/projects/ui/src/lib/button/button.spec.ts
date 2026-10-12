import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { UiButton } from './button';

@Component({
  imports: [UiButton],
  template: ` <form (submit)="submitted.set(true); $event.preventDefault()">
    <ui-button [disabled]="disabled()" [type]="type()" (pressed)="count.set(count() + 1)"
      >Speichern</ui-button
    >
  </form>`,
})
class Host {
  readonly disabled = signal(false);
  readonly type = signal<'button' | 'submit'>('button');
  readonly count = signal(0);
  readonly submitted = signal(false);
}

function render() {
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
  return { fixture, button, host: fixture.componentInstance };
}

describe('UiButton', () => {
  it('emits pressed on click', () => {
    const { button, host } = render();
    button.click();
    expect(host.count()).toBe(1);
  });

  it('does not emit or submit when disabled', () => {
    const { fixture, button, host } = render();
    host.disabled.set(true);
    host.type.set('submit');
    fixture.detectChanges();
    button.click();
    expect(button.disabled).toBe(true);
    expect(host.count()).toBe(0);
    expect(host.submitted()).toBe(false);
  });

  it('is a plain button by default and submits only as type submit', () => {
    const { fixture, button, host } = render();
    expect(button.type).toBe('button');
    host.type.set('submit');
    fixture.detectChanges();
    button.click();
    expect(host.submitted()).toBe(true);
  });
});
