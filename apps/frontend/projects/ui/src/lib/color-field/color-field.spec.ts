import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { UiColorField } from './color-field';

@Component({
  imports: [UiColorField],
  template: `<ui-color-field
    label="Grundfarbe"
    pickerLabel="Grundfarbe wählen"
    invalidMessage="Bitte als #rrggbb eingeben."
    [(value)]="color"
    [disabled]="disabled()"
  />`,
})
class Host {
  readonly color = signal('#00687a');
  readonly disabled = signal(false);
}

function render() {
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  const text = fixture.nativeElement.querySelector('input[type="text"]') as HTMLInputElement;
  const picker = fixture.nativeElement.querySelector('input[type="color"]') as HTMLInputElement;
  return { fixture, text, picker, host: fixture.componentInstance };
}

function type(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

describe('UiColorField', () => {
  it('shows the bound color in both inputs', () => {
    const { text, picker } = render();
    expect(text.value).toBe('#00687a');
    expect(picker.value).toBe('#00687a');
    expect(picker.getAttribute('aria-label')).toBe('Grundfarbe wählen');
  });

  it('emits normalized colors only', () => {
    const { fixture, text, host } = render();
    type(text, '#12');
    fixture.detectChanges();
    expect(host.color()).toBe('#00687a');
    type(text, '6F9D2F');
    fixture.detectChanges();
    expect(host.color()).toBe('#6f9d2f');
  });

  it('shows the invalid message after leaving an invalid entry', () => {
    const { fixture, text } = render();
    type(text, 'rot');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('Bitte als #rrggbb eingeben.');
    text.dispatchEvent(new Event('blur'));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Bitte als #rrggbb eingeben.');
    expect(text.getAttribute('aria-invalid')).toBe('true');
  });

  it('keeps the typed text while its normalized color is emitted', () => {
    const { fixture, text, picker, host } = render();
    type(text, '8a5');
    fixture.detectChanges();
    expect(host.color()).toBe('#88aa55');
    expect(text.value).toBe('8a5');
    expect(picker.value).toBe('#88aa55');
  });

  it('replaces the text when the color changes from outside', () => {
    const { fixture, text, host } = render();
    type(text, '8a5');
    fixture.detectChanges();
    host.color.set('#112233');
    fixture.detectChanges();
    expect(text.value).toBe('#112233');
  });

  it('takes the color chosen in the picker', () => {
    const { fixture, picker, host } = render();
    type(picker, '#8a5a00');
    fixture.detectChanges();
    expect(host.color()).toBe('#8a5a00');
  });

  it('disables the text input and the picker', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.disabled.set(true);
    fixture.detectChanges();
    const inputs = [...fixture.nativeElement.querySelectorAll('input')] as HTMLInputElement[];
    expect(inputs).toHaveLength(2);
    expect(inputs.every((input) => input.disabled)).toBe(true);
  });
});
