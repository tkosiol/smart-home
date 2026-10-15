import { BreakpointObserver, type BreakpointState } from '@angular/cdk/layout';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { MEDIUM } from '../adaptive-shell/adaptive-shell';
import { provideUiTranslocoTesting } from '../testing/i18n-testing';
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
  const state: BreakpointState = { matches: medium, breakpoints: { [MEDIUM]: medium } };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideUiTranslocoTesting(),
      { provide: BreakpointObserver, useValue: { observe: () => of(state) } },
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
    arrows: () => [...element.querySelectorAll<HTMLElement>('.arrows button')],
  };
}

describe('UiPodRow', () => {
  it('scrolls horizontally with snapping and no arrows on compact windows', async () => {
    const { element, scroller, arrows } = await render(false);
    expect(scroller).not.toBeNull();
    expect(element.querySelector('ui-pod-row')?.hasAttribute('data-wrap')).toBe(false);
    expect(arrows()).toHaveLength(0);
    expect(scroller.querySelectorAll('ui-device-pod')).toHaveLength(3);
  });

  it('offers labelled arrows from medium windows up that page the row', async () => {
    const { scroller, arrows } = await render(true);
    expect(arrows().map((arrow) => arrow.getAttribute('aria-label'))).toEqual([
      'Zurück blättern',
      'Weiter blättern',
    ]);
    const scrollBy = vi.fn();
    scroller.scrollBy = scrollBy;
    Object.defineProperty(scroller, 'clientWidth', { value: 300, configurable: true });
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
});
