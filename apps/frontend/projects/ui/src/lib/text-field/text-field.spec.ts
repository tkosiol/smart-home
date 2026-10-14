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
    [inputmode]="inputmode()"
  />`,
})
class Host {
  readonly inputmode = signal<'numeric' | undefined>(undefined);
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

@Component({
  imports: [UiTextField],
  template: `<ui-text-field
    label="Zertifikat"
    multiline
    [verbatim]="verbatim()"
    [rows]="rows()"
    hint="PEM einfügen"
    [error]="error()"
    required
    [(value)]="text"
  />`,
})
class MultilineHost {
  readonly text = signal('');
  readonly rows = signal(6);
  readonly verbatim = signal(false);
  readonly error = signal<string | null>(null);
}

@Component({
  imports: [UiTextField],
  template: `<ui-text-field label="Kennung" verbatim [(value)]="text" />`,
})
class VerbatimHost {
  readonly text = signal('');
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

  it('passes the keyboard hint only when one is given', () => {
    const { fixture, input, host } = render();
    expect(input.hasAttribute('inputmode')).toBe(false);
    host.inputmode.set('numeric');
    fixture.detectChanges();
    expect(input.getAttribute('inputmode')).toBe('numeric');
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

  it('keeps a required input invalid when the user empties it while the error stays', () => {
    const fixture = TestBed.createComponent(RequiredHost);
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    input.value = 'a';
    input.dispatchEvent(new Event('input'));
    fixture.componentInstance.error.set('Pflichtfeld');
    fixture.detectChanges();
    expect(input.getAttribute('aria-invalid')).toBe('true');
    input.value = '';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(fixture.componentInstance.name()).toBe('');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    fixture.componentInstance.error.set(null);
    fixture.detectChanges();
    expect(input.getAttribute('aria-invalid')).not.toBe('true');
  });

  it('turns spell check, capitalization and correction off for a verbatim single-line input', () => {
    const fixture = TestBed.createComponent(VerbatimHost);
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    expect(input.getAttribute('spellcheck')).toBe('false');
    expect(input.getAttribute('autocapitalize')).toBe('off');
    expect(input.getAttribute('autocorrect')).toBe('off');
  });

  describe('multiline', () => {
    function renderMultiline() {
      const fixture = TestBed.createComponent(MultilineHost);
      fixture.detectChanges();
      const area = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
      return { fixture, area, host: fixture.componentInstance };
    }

    it('renders a labelled textarea instead of an input', () => {
      const { fixture, area } = renderMultiline();
      expect(fixture.nativeElement.querySelector('input')).toBeNull();
      const label = fixture.nativeElement.querySelector('label') as HTMLLabelElement;
      expect(label.htmlFor).toBe(area.id);
      expect(area.rows).toBe(6);
      expect(fixture.nativeElement.textContent).toContain('PEM einfügen');
    });

    it('keeps line breaks when writing back to the binding and follows the row count', () => {
      const { fixture, area, host } = renderMultiline();
      area.value = 'a\nb\nc';
      area.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      expect(host.text()).toBe('a\nb\nc');
      host.rows.set(3);
      fixture.detectChanges();
      expect(area.rows).toBe(3);
    });

    it('marks the textarea invalid while an error is shown', () => {
      const { fixture, area, host } = renderMultiline();
      host.error.set('Pflichtfeld');
      fixture.detectChanges();
      expect(area.getAttribute('aria-invalid')).toBe('true');
      expect(fixture.nativeElement.textContent).toContain('Pflichtfeld');
      host.error.set(null);
      fixture.detectChanges();
      expect(area.getAttribute('aria-invalid')).not.toBe('true');
    });

    it('leaves spell check, capitalization and correction alone by default', () => {
      const { area } = renderMultiline();
      expect(area.hasAttribute('spellcheck')).toBe(false);
      expect(area.hasAttribute('autocapitalize')).toBe(false);
      expect(area.hasAttribute('autocorrect')).toBe(false);
    });

    it('turns spell check, capitalization and correction off for verbatim text', () => {
      const { fixture, area, host } = renderMultiline();
      host.verbatim.set(true);
      fixture.detectChanges();
      expect(area.getAttribute('spellcheck')).toBe('false');
      expect(area.getAttribute('autocapitalize')).toBe('off');
      expect(area.getAttribute('autocorrect')).toBe('off');
    });

    it('stays a single-line input by default', () => {
      const { fixture } = render();
      expect(fixture.nativeElement.querySelector('textarea')).toBeNull();
    });
  });
});
