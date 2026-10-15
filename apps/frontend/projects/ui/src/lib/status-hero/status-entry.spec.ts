import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideUiTranslocoTesting } from '../testing/i18n-testing';
import { UiStatusEntry, type UiStatusEntryVariant } from './status-entry';

@Component({
  imports: [UiStatusEntry],
  template: `<ui-status-entry
    [variant]="variant()"
    icon="router"
    kindTone="ok-container"
    title="Gateway Flur"
    subtitle="Gateway online"
    [route]="route()"
  />`,
})
class Host {
  readonly variant = signal<UiStatusEntryVariant>('entry');
  readonly route = signal<string | undefined>(undefined);
}

function render() {
  TestBed.configureTestingModule({
    providers: [provideRouter([]), provideUiTranslocoTesting('de')],
  });
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  const entry = () => (fixture.nativeElement as HTMLElement).querySelector('ui-status-entry')!;
  return { fixture, entry };
}

describe('UiStatusEntry', () => {
  it('is an entry unless said otherwise', () => {
    TestBed.configureTestingModule({
      imports: [UiStatusEntry],
      providers: [provideRouter([]), provideUiTranslocoTesting('de')],
    });
    const fixture = TestBed.createComponent(UiStatusEntry);
    fixture.componentRef.setInput('icon', 'router');
    fixture.componentRef.setInput('kindTone', 'surface');
    fixture.componentRef.setInput('title', 'x');
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).getAttribute('data-variant')).toBe('entry');
  });

  it.each(['entry', 'row', 'bare'] as const)('marks the variant %s on its host', (variant) => {
    const { fixture, entry } = render();
    fixture.componentInstance.variant.set(variant);
    fixture.detectChanges();
    expect(entry().getAttribute('data-variant')).toBe(variant);
  });

  it('is a link with a route, and plain content without one, in every variant', () => {
    const { fixture, entry } = render();
    for (const variant of ['entry', 'row', 'bare'] as const) {
      fixture.componentInstance.variant.set(variant);
      fixture.componentInstance.route.set(undefined);
      fixture.detectChanges();
      expect(entry().querySelector('a')).toBeNull();
      fixture.componentInstance.route.set('/mehr/gateways');
      fixture.detectChanges();
      expect(entry().querySelector('a.link')?.getAttribute('href')).toBe('/mehr/gateways');
    }
  });
});
