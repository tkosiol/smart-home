import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { UiTone } from '../tone';
import { UiList } from './list';
import { UiListItem } from './list-item';

@Component({
  imports: [UiList, UiListItem],
  template: ` <ui-list>
    <ui-list-item
      icon="settings"
      headline="Einstellungen"
      supporting="Darstellung und Sprache"
      route="/mehr/einstellungen"
    />
    <ui-list-item
      icon="sensors"
      headline="Gateways"
      trailingText="kommt bald"
      route="/mehr/gateways"
      [disabled]="disabled()"
    />
  </ui-list>`,
})
class Host {
  readonly disabled = signal(true);
}

function render() {
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  return fixture;
}

describe('UiListItem', () => {
  it('renders a list of list items', () => {
    const fixture = render();
    expect(fixture.nativeElement.querySelector('ui-list').getAttribute('role')).toBe('list');
    expect(fixture.nativeElement.querySelectorAll('[role="listitem"]')).toHaveLength(2);
  });

  it('links enabled entries to their route', () => {
    const fixture = render();
    const link = fixture.nativeElement.querySelector('a') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/mehr/einstellungen');
    expect(link.textContent).toContain('Einstellungen');
    expect(link.textContent).toContain('Darstellung und Sprache');
  });

  it('renders disabled entries without a link', () => {
    const fixture = render();
    expect(fixture.nativeElement.querySelectorAll('a')).toHaveLength(1);
    expect(fixture.nativeElement.querySelector('[aria-disabled]')).toBeNull();
    const disabled = fixture.nativeElement.querySelector('.row:not(.row--link)') as HTMLElement;
    expect(disabled.textContent).toContain('Gateways');
    expect(disabled.textContent).toContain('kommt bald');
    expect(disabled.classList).toContain('row--disabled');
  });

  it('becomes a link once enabled', () => {
    const fixture = render();
    fixture.componentInstance.disabled.set(false);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('a')).toHaveLength(2);
  });
});

@Component({
  imports: [UiList, UiListItem],
  template: `<ui-list>
    <ui-list-item
      icon="router"
      headline="Gateway Garten"
      [leadingTone]="tone()"
      route="/gateways/1"
    />
  </ui-list>`,
})
class ToneHost {
  readonly tone = signal<UiTone | undefined>('ok-container');
}

describe('UiListItem leading tone', () => {
  function renderTone() {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(ToneHost);
    fixture.detectChanges();
    return fixture;
  }

  it('wraps the icon in a container of the given tone', () => {
    const fixture = renderTone();
    const container = fixture.nativeElement.querySelector('.leading-container') as HTMLElement;
    expect(container.getAttribute('data-tone')).toBe('ok-container');
    expect(container.querySelector('ui-icon')).not.toBeNull();
    expect(container.getAttribute('aria-hidden')).toBe('true');
    expect(fixture.nativeElement.querySelector('ui-icon.leading')).toBeNull();
  });

  it('shows the plain icon without a tone', () => {
    const fixture = renderTone();
    fixture.componentInstance.tone.set(undefined);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.leading-container')).toBeNull();
    expect(fixture.nativeElement.querySelector('ui-icon.leading')).not.toBeNull();
  });
});
