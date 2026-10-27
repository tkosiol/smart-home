import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { EXPANDED, MEDIUM, UiAdaptiveShell, UiShellBanner, UiShellTopBar } from './adaptive-shell';
import { MEDIA_QUERIES } from '../theme/media-queries';
import { FakeMediaQueries } from '../theme/testing/fake-media-queries';
import type { UiNavDestination } from './navigation';

const DESTINATIONS: readonly UiNavDestination[] = [
  { route: '/', label: 'Start', icon: 'home', exact: true },
  { route: '/raeume', label: 'Räume', icon: 'meeting_room' },
  { route: '/geraete', label: 'Geräte', icon: 'devices' },
  { route: '/mehr', label: 'Mehr', icon: 'more_horiz' },
];

@Component({
  imports: [UiAdaptiveShell, UiShellTopBar, UiShellBanner],
  template: `<ui-adaptive-shell [destinations]="destinations" navigationLabel="Hauptnavigation">
    <header uiShellTopBar>Kopf</header>
    <div uiShellBanner>Hinweis</div>
    <p>Inhalt</p>
  </ui-adaptive-shell>`,
})
class Host {
  readonly destinations = DESTINATIONS;
}

function render(medium: boolean, expanded: boolean, media = new FakeMediaQueries()) {
  media.state[MEDIUM] = medium || expanded;
  media.state[EXPANDED] = expanded;
  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ path: '**', children: [] }]),
      { provide: MEDIA_QUERIES, useValue: media },
    ],
  });
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  return fixture;
}

describe('UiAdaptiveShell', () => {
  it('changes its window class when the window is resized', () => {
    const media = new FakeMediaQueries();
    const fixture = render(false, false, media);
    const shell = fixture.nativeElement.querySelector('ui-adaptive-shell') as HTMLElement;
    media.emit(MEDIUM, true);
    media.emit(EXPANDED, true);
    fixture.detectChanges();
    expect(shell.getAttribute('data-window-class')).toBe('expanded');
    media.emit(EXPANDED, false);
    fixture.detectChanges();
    expect(shell.getAttribute('data-window-class')).toBe('medium');
  });

  it.each([
    ['compact', false, false],
    ['medium', true, false],
    ['expanded', true, true],
  ])('marks the %s window class on the host', (name, medium, expanded) => {
    const fixture = render(medium, expanded);
    const shell = fixture.nativeElement.querySelector('ui-adaptive-shell') as HTMLElement;
    expect(shell.getAttribute('data-window-class')).toBe(name);
  });

  it('renders a named navigation with four named links', () => {
    const fixture = render(false, false);
    const element = fixture.nativeElement as HTMLElement;
    const nav = element.querySelector('nav')!;
    expect(nav.getAttribute('aria-label')).toBe('Hauptnavigation');
    // The icon glyph is aria-hidden, so the label alone names the link.
    const links = [...nav.querySelectorAll('a .label')];
    expect(links.map((label) => label.textContent?.trim())).toEqual([
      'Start',
      'Räume',
      'Geräte',
      'Mehr',
    ]);
  });

  it('orders top bar, banner, navigation and main, and puts the content into main', () => {
    const fixture = render(false, false);
    const shell = (fixture.nativeElement as HTMLElement).querySelector('ui-adaptive-shell')!;
    const order = [...shell.querySelectorAll('header, [uiShellBanner], nav, main')].map(
      (element) => element.localName,
    );
    expect(order).toEqual(['header', 'div', 'nav', 'main']);
    expect(shell.querySelector('main')?.textContent).toContain('Inhalt');
  });

  it('marks the active link with aria-current="page" after navigation', async () => {
    const fixture = render(false, false);
    await TestBed.inject(Router).navigateByUrl('/raeume');
    fixture.detectChanges();
    const links = [...(fixture.nativeElement as HTMLElement).querySelectorAll('nav a')];
    expect(links.map((link) => link.getAttribute('aria-current'))).toEqual([
      null,
      'page',
      null,
      null,
    ]);
  });
});
