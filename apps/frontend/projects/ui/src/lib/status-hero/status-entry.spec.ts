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
    [headingLevel]="headingLevel()"
  />`,
})
class Host {
  readonly variant = signal<UiStatusEntryVariant>('entry');
  readonly route = signal<string | undefined>(undefined);
  readonly headingLevel = signal<2 | 3 | 4 | undefined>(undefined);
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

  it('makes the title a heading of the given level, and plain text without one', () => {
    const { fixture, entry } = render();
    expect(entry().querySelector('[role="heading"]')).toBeNull();
    for (const level of [2, 3, 4] as const) {
      fixture.componentInstance.headingLevel.set(level);
      fixture.detectChanges();
      const heading = entry().querySelector('[role="heading"]')!;
      expect(heading.getAttribute('aria-level')).toBe(String(level));
      expect(heading.textContent?.trim()).toBe('Gateway Flur');
    }
  });

  it('keeps the heading inside the link of a linked entry', () => {
    const { fixture, entry } = render();
    fixture.componentInstance.headingLevel.set(3);
    fixture.componentInstance.route.set('/mehr/gateways');
    fixture.detectChanges();
    expect(entry().querySelector('a [role="heading"]')?.textContent?.trim()).toBe('Gateway Flur');
  });
});
