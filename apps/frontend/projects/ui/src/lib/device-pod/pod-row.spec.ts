import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MEDIUM } from '../adaptive-shell/adaptive-shell';
import { provideUiTranslocoTesting } from '../testing/i18n-testing';
import { MEDIA_QUERIES } from '../theme/media-queries';
import { FakeMediaQueries } from '../theme/testing/fake-media-queries';
import { UiDevicePod } from './device-pod';
import { UiPodRow } from './pod-row';

@Component({
  imports: [UiPodRow, UiDevicePod],
  template: `<ui-pod-row [wrap]="wrap()">
    <ui-device-pod kind="soil" icon="potted_plant" value="24" label="Monstera" route="/g/1" />
    <ui-device-pod kind="soil" icon="potted_plant" value="38" label="Grünlilie" route="/g/2" />
    <ui-device-pod kind="contact" icon="door_open" value="Offen" label="Fenster" route="/g/3" />
  </ui-pod-row>`,
})
class Host {
  readonly wrap = signal(false);
}

async function render(medium: boolean, setup: (host: Host) => void = () => undefined) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideUiTranslocoTesting(),
      { provide: MEDIA_QUERIES, useValue: new FakeMediaQueries({ [MEDIUM]: medium }) },
    ],
  });
  const fixture = TestBed.createComponent(Host);
  setup(fixture.componentInstance);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  const element = fixture.nativeElement as HTMLElement;
  return {
    fixture,
    host: fixture.componentInstance,
    element,
    scroller: element.querySelector<HTMLElement>('.scroller')!,
    arrows: () => [...element.querySelectorAll<HTMLButtonElement>('.arrows button')],
  };
}

/** Gives the scroller the geometry jsdom lacks and tells the row about a scroll. */
function geometry(
  scroller: HTMLElement,
  fixture: { detectChanges(): void },
  values: { scrollWidth: number; clientWidth: number; scrollLeft: number },
): void {
  for (const [name, value] of Object.entries(values)) {
    Object.defineProperty(scroller, name, { value, configurable: true });
  }
  scroller.dispatchEvent(new Event('scroll'));
  fixture.detectChanges();
}

describe('UiPodRow', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('scrolls horizontally with snapping and no arrows on compact windows', async () => {
    const { element, scroller, arrows } = await render(false);
    expect(scroller).not.toBeNull();
    expect(element.querySelector('ui-pod-row')?.hasAttribute('data-wrap')).toBe(false);
    expect(arrows()).toHaveLength(0);
    expect(scroller.querySelectorAll('ui-device-pod')).toHaveLength(3);
  });

  it('offers labelled arrows from medium windows up that page the row', async () => {
    const { fixture, scroller, arrows } = await render(true);
    geometry(scroller, fixture, { scrollWidth: 900, clientWidth: 300, scrollLeft: 300 });
    expect(arrows().map((arrow) => arrow.getAttribute('aria-label'))).toEqual([
      'Zurück blättern',
      'Weiter blättern',
    ]);
    const scrollBy = vi.fn();
    scroller.scrollBy = scrollBy;
    arrows()[1]!.click();
    expect(scrollBy).toHaveBeenCalledWith(expect.objectContaining({ left: 300 }));
    arrows()[0]!.click();
    expect(scrollBy).toHaveBeenCalledWith(expect.objectContaining({ left: -300 }));
  });

  it('wraps instead of scrolling and shows no arrows when wrap is set', async () => {
    const { element, arrows } = await render(true, (host) => host.wrap.set(true));
    expect(element.querySelector('ui-pod-row')?.hasAttribute('data-wrap')).toBe(true);
    expect(arrows()).toHaveLength(0);
  });

  it('brings a focused pod into view', async () => {
    const { element, scroller } = await render(false);
    const pod = element.querySelectorAll<HTMLElement>('.pod')[2]!;
    const scrollIntoView = vi.fn();
    pod.scrollIntoView = scrollIntoView;
    pod.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
    expect(scroller.contains(pod)).toBe(true);
  });

  it('shows no arrows while the row fits', async () => {
    const { fixture, scroller, arrows } = await render(true);
    geometry(scroller, fixture, { scrollWidth: 300, clientWidth: 300, scrollLeft: 0 });
    expect(arrows()).toHaveLength(0);
  });

  it('disables the arrow at the end the row has reached', async () => {
    const { fixture, scroller, arrows } = await render(true);
    const disabled = () => arrows().map((arrow) => arrow.disabled);
    geometry(scroller, fixture, { scrollWidth: 900, clientWidth: 300, scrollLeft: 0 });
    expect(disabled()).toEqual([true, false]);
    geometry(scroller, fixture, { scrollWidth: 900, clientWidth: 300, scrollLeft: 300 });
    expect(disabled()).toEqual([false, false]);
    geometry(scroller, fixture, { scrollWidth: 900, clientWidth: 300, scrollLeft: 600 });
    expect(disabled()).toEqual([false, true]);
  });

  it('measures again when the row is resized', async () => {
    let notify: () => void = () => undefined;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          notify = callback;
        }
        observe(): void {}
        disconnect(): void {}
      },
    );
    const { fixture, scroller, arrows } = await render(true);
    expect(arrows()).toHaveLength(0);
    for (const [name, value] of Object.entries({ scrollWidth: 900, clientWidth: 300 })) {
      Object.defineProperty(scroller, name, { value, configurable: true });
    }
    notify();
    fixture.detectChanges();
    expect(arrows()).toHaveLength(2);
  });
});
