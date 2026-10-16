import { Component, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, type UrlTree } from '@angular/router';
import { provideUiTranslocoTesting } from '../testing/i18n-testing';
import { UiStatusEntry } from './status-entry';
import { UiStatusHero, type UiStatusHeroTone } from './status-hero';

@Component({
  imports: [UiStatusHero, UiStatusEntry],
  template: `<ui-status-hero
    [tone]="tone()"
    heading="Braucht Aufmerksamkeit"
    [count]="count()"
    [criticalCount]="criticalCount()"
    [moreLabel]="moreLabel()"
    moreRoute="/hinweise"
  >
    @if (tone() === 'calm') {
      <span class="detail">Gateway online · 9 Geräte · vor 3 min</span>
    } @else {
      <ui-status-entry
        icon="router"
        kindTone="error"
        title="Gateway Garten offline"
        subtitle="12 Geräte nicht erreichbar · seit 40 min"
        severityLabel="Kritisch"
        route="/gateways/garten"
      />
      <ui-status-entry
        icon="water_drop"
        kindTone="dry-container"
        title="5 Pflanzen zu trocken"
        subtitle="Ficus, Efeutute, Farn, Gummibaum, Monstera"
        value="18 %"
        [route]="groupRoute"
      />
    }
  </ui-status-hero>`,
})
class Host {
  readonly tone = signal<UiStatusHeroTone>('critical');
  readonly count = signal(20);
  readonly criticalCount = signal(2);
  readonly moreLabel = signal<string | undefined>('3 weitere Gruppen');
  readonly groupRoute: UrlTree = inject(Router).createUrlTree(['/hinweise'], {
    queryParams: { kind: 'soil_dry' },
  });
}

async function render(language: 'de' | 'en' = 'de', setup: (host: Host) => void = () => undefined) {
  TestBed.configureTestingModule({
    providers: [provideRouter([]), provideUiTranslocoTesting(language)],
  });
  const fixture = TestBed.createComponent(Host);
  setup(fixture.componentInstance);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  const element = fixture.nativeElement as HTMLElement;
  const text = (selector: string) => element.querySelector(selector)?.textContent?.trim();
  return { fixture, host: fixture.componentInstance, element, text };
}

describe('UiStatusHero', () => {
  it('is a region named by its heading with the count', async () => {
    const { element, text } = await render();
    const region = element.querySelector('[role="region"]')!;
    const heading = element.querySelector('h2')!;
    expect(region.getAttribute('aria-labelledby')).toBe(heading.id);
    expect(text('h2')).toBe('Braucht Aufmerksamkeit · 20');
    expect(element.querySelector('ui-status-hero')?.getAttribute('data-tone')).toBe('critical');
  });

  it('shows the critical count only when there is one', async () => {
    const { fixture, host, text } = await render();
    expect(text('.critical')).toBe('2 kritisch');
    host.criticalCount.set(0);
    fixture.detectChanges();
    expect(text('.critical')).toBeUndefined();
  });

  it('always links to all notices, with the count and the more label', async () => {
    const { fixture, host, element, text } = await render();
    const more = element.querySelector<HTMLAnchorElement>('a.more')!;
    expect(more.getAttribute('href')).toBe('/hinweise');
    expect(text('.more-label')).toBe('Alle 20 Hinweise');
    expect(text('.more-detail')).toBe('3 weitere Gruppen');
    host.moreLabel.set(undefined);
    fixture.detectChanges();
    expect(text('.more-detail')).toBeUndefined();
    expect(text('.more-label')).toBe('Alle 20 Hinweise');
  });

  it('projects the entries as links with their tones, values and severity', async () => {
    const { element } = await render();
    const entries = [...element.querySelectorAll<HTMLAnchorElement>('ui-status-entry a')];
    expect(entries.map((entry) => entry.getAttribute('href'))).toEqual([
      '/gateways/garten',
      '/hinweise?kind=soil_dry',
    ]);
    expect(entries[0]!.querySelector('.chevron')).toBeNull();
    expect(entries[1]!.querySelector('.chevron')).not.toBeNull();
    expect(entries[0]!.querySelector('.lead')?.getAttribute('data-tone')).toBe('error');
    expect(entries[0]!.querySelector('.severity')?.textContent?.trim()).toBe('Kritisch');
    expect(entries[0]!.querySelector('.severity')?.getAttribute('data-tone')).toBe('error');
    expect(entries[0]!.querySelector('.value')).toBeNull();
    expect(entries[1]!.querySelector('.value')?.textContent?.trim()).toBe('18 %');
    expect(entries[1]!.querySelector('.value')?.getAttribute('data-tone')).toBe('dry');
    expect(entries[1]!.querySelector('.severity')).toBeNull();
    expect(entries[1]!.querySelector('.lead')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('shows the calm row with the projected detail and a link to all notices', async () => {
    const { element, text } = await render('de', (host) => {
      host.tone.set('calm');
      host.count.set(0);
      host.criticalCount.set(0);
    });
    expect(element.querySelector('ui-status-hero')?.getAttribute('data-tone')).toBe('calm');
    expect(text('h2')).toBe('Alles in Ordnung');
    expect(text('.detail')).toBe('Gateway online · 9 Geräte · vor 3 min');
    expect(element.querySelector('a.calm')?.getAttribute('href')).toBe('/hinweise');
    expect(element.querySelector('.leading-container')?.getAttribute('data-tone')).toBe(
      'ok-container',
    );
    expect(element.querySelector('a.more')).toBeNull();
    // The region is named by the heading and the detail: "Alles in Ordnung Gateway online …".
    expect(element.querySelector('[role="region"]')?.getAttribute('aria-labelledby')).toBe(
      `${element.querySelector('h2')?.id} ${element.querySelector('.detail')?.id}`,
    );
  });

  it('translates its own texts', async () => {
    const { text } = await render('en');
    expect(text('h2')).toBe('Braucht Aufmerksamkeit · 20');
    expect(text('.critical')).toBe('2 critical');
    expect(text('.more-label')).toBe('All 20 notices');
  });
});
