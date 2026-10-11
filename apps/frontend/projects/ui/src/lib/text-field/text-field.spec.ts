import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { UiTextField } from './text-field';

@Component({
  imports: [UiTextField],
  template: `<ui-text-field
    label="E-Mail"
    type="email"
    hint="Wir schicken dir einen Code."
    [error]="error()"
    [(value)]="email"
    autocomplete="email"
  />`,
})
class Host {
  readonly email = signal('');
  readonly error = signal<string | null>(null);
}

@Component({
  imports: [UiTextField],
  template: `<ui-text-field label="Name" required [error]="error()" [(value)]="name" />`,
})
class RequiredHost {
  readonly name = signal('');
  readonly error = signal<string | null>(null);
}

function render() {
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
  return { fixture, input, host: fixture.componentInstance };
}

describe('UiTextField', () => {
  it('labels the input and passes type and autocomplete', () => {
    const { fixture, input } = render();
    const label = fixture.nativeElement.querySelector('label') as HTMLLabelElement;
    expect(label.textContent).toContain('E-Mail');
    expect(label.htmlFor).toBe(input.id);
    expect(input.type).toBe('email');
    expect(input.getAttribute('autocomplete')).toBe('email');
  });

  it('writes typed text back to the binding', () => {
    const { fixture, input, host } = render();
    input.value = 'till@example.org';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(host.email()).toBe('till@example.org');
  });

  it('shows the error instead of the hint and marks the input invalid', () => {
    const { fixture, input, host } = render();
    expect(fixture.nativeElement.textContent).toContain('Wir schicken dir einen Code.');
    host.error.set('Bitte eine gültige E-Mail-Adresse eingeben.');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(
      'Bitte eine gültige E-Mail-Adresse eingeben.',
    );
    expect(fixture.nativeElement.textContent).not.toContain('Wir schicken dir einen Code.');
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('marks a required, empty input invalid while an error is shown', () => {
    const fixture = TestBed.createComponent(RequiredHost);
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    expect(input.getAttribute('aria-invalid')).not.toBe('true');
    fixture.componentInstance.error.set('Pflichtfeld');
    fixture.detectChanges();
    expect(input.value).toBe('');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    fixture.componentInstance.error.set(null);
    fixture.detectChanges();
    expect(input.getAttribute('aria-invalid')).not.toBe('true');
  });
});
