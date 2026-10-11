import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ICON_CODEPOINTS, type IconName } from './icon-codepoints';
import { UiIcon } from './icon';

@Component({
  imports: [UiIcon],
  template: `<ui-icon [name]="name()" [label]="label()" [filled]="filled()" />`,
})
class Host {
  readonly name = signal<IconName>('home');
  readonly label = signal<string | undefined>(undefined);
  readonly filled = signal(false);
}

function render() {
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  const icon = fixture.nativeElement.querySelector('ui-icon') as HTMLElement;
  return { fixture, icon };
}

describe('UiIcon', () => {
  it('renders the glyph of the named icon', () => {
    const { icon } = render();
    expect(icon.textContent).toBe(String.fromCodePoint(ICON_CODEPOINTS.home));
  });

  it('is hidden from assistive technology without a label', () => {
    const { icon } = render();
    expect(icon.getAttribute('aria-hidden')).toBe('true');
    expect(icon.getAttribute('role')).toBeNull();
  });

  it('is an image with the label as its name when labelled', () => {
    const { fixture, icon } = render();
    fixture.componentInstance.label.set('Feuchtigkeit');
    fixture.detectChanges();
    expect(icon.getAttribute('role')).toBe('img');
    expect(icon.getAttribute('aria-label')).toBe('Feuchtigkeit');
    expect(icon.getAttribute('aria-hidden')).toBeNull();
  });

  it('marks filled icons', () => {
    const { fixture, icon } = render();
    fixture.componentInstance.filled.set(true);
    fixture.detectChanges();
    expect(icon.classList).toContain('ui-icon--filled');
  });
});
