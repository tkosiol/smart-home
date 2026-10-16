import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { DeviceKind } from '@smart/contracts';
import { UiDevicePod, type UiDevicePodChip } from './device-pod';

@Component({
  imports: [UiDevicePod],
  template: `<ui-device-pod
    [kind]="kind()"
    icon="lightbulb"
    [value]="value()"
    [unit]="unit()"
    [label]="label()"
    [chip]="chip()"
    [route]="route()"
    [pressed]="pressed()"
    [pending]="pending()"
    (toggled)="toggles.set(toggles() + 1)"
  />`,
})
class Host {
  readonly kind = signal<DeviceKind>('light');
  readonly value = signal('80');
  readonly unit = signal<string | undefined>('%');
  readonly label = signal('Deckenlampe · Warmweiß');
  readonly chip = signal<UiDevicePodChip | null>({ text: 'An', tone: 'primary' });
  readonly route = signal<string | undefined>(undefined);
  readonly pressed = signal<boolean | undefined>(true);
  readonly pending = signal(false);
  readonly toggles = signal(0);
}

function render(setup: (host: Host) => void = () => undefined) {
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  const fixture = TestBed.createComponent(Host);
  setup(fixture.componentInstance);
  fixture.detectChanges();
  const element = fixture.nativeElement as HTMLElement;
  return { fixture, host: fixture.componentInstance, pod: () => element.querySelector('.pod')! };
}

describe('UiDevicePod', () => {
  describe('switch mode', () => {
    it('is a toggle button named by its content in reading order', () => {
      const { pod } = render();
      expect(pod().tagName).toBe('BUTTON');
      expect(pod().getAttribute('aria-pressed')).toBe('true');
      expect(pod().hasAttribute('aria-label')).toBe(false);
      // The icon glyph precedes it in the text but is aria-hidden; the name is the rest.
      expect(pod().textContent?.replace(/\s+/g, '')).toContain('An80%Deckenlampe');
    });

    it('emits toggled on click and reflects the pressed state', () => {
      const { fixture, host, pod } = render();
      (pod() as HTMLButtonElement).click();
      expect(host.toggles()).toBe(1);
      host.pressed.set(false);
      fixture.detectChanges();
      expect(pod().getAttribute('aria-pressed')).toBe('false');
    });

    it('blocks a second toggle while pending and marks the pod busy', () => {
      const { fixture, host, pod } = render();
      (pod() as HTMLButtonElement).click();
      host.pending.set(true);
      fixture.detectChanges();
      expect(pod().getAttribute('aria-busy')).toBe('true');
      expect(pod().classList).toContain('pod--pending');
      (pod() as HTMLButtonElement).click();
      expect(host.toggles()).toBe(1);
      host.pending.set(false);
      fixture.detectChanges();
      expect(pod().hasAttribute('aria-busy')).toBe(false);
      (pod() as HTMLButtonElement).click();
      expect(host.toggles()).toBe(2);
    });
  });

  describe('link mode', () => {
    it('is a link to the device without a pressed state', () => {
      const { pod } = render((h) => h.route.set('/geraete/1'));
      expect(pod().tagName).toBe('A');
      expect(pod().getAttribute('href')).toBe('/geraete/1');
      expect(pod().hasAttribute('aria-pressed')).toBe(false);
      expect(pod().textContent).toContain('Deckenlampe');
    });

    it('is plain content without a route and without a pressed state', () => {
      const { pod } = render((h) => h.pressed.set(undefined));
      expect(pod().tagName).toBe('DIV');
      expect(pod().textContent).toContain('Deckenlampe');
    });
  });

  describe('colour by kind (spec 2.4)', () => {
    it('paints a lit lamp primary and an unlit one as the off surface', () => {
      const { fixture, host, pod } = render((h) => h.route.set('/geraete/1'));
      expect(pod().getAttribute('data-tone')).toBe('primary');
      host.pressed.set(false);
      fixture.detectChanges();
      expect(pod().getAttribute('data-tone')).toBe('off');
      host.pressed.set(undefined);
      fixture.detectChanges();
      expect(pod().getAttribute('data-tone')).toBe('off');
    });

    it('paints soil tertiary, climate and contact secondary, other as surface', () => {
      const { fixture, host, pod } = render((h) => h.route.set('/geraete/1'));
      const toneOf = (kind: DeviceKind) => {
        host.kind.set(kind);
        fixture.detectChanges();
        return pod().getAttribute('data-tone');
      };
      expect(toneOf('soil')).toBe('tertiary-container');
      expect(toneOf('climate')).toBe('secondary-container');
      expect(toneOf('contact')).toBe('secondary-container');
      expect(toneOf('other')).toBe('surface');
    });
  });

  it('shows the chip in its container colour and leaves it out when null', () => {
    const { fixture, host } = render((h) => h.chip.set({ text: 'trocken', tone: 'dry' }));
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.chip')?.textContent?.trim()).toBe('trocken');
    expect(element.querySelector('.chip')?.getAttribute('data-tone')).toBe('dry-container');
    host.chip.set(null);
    fixture.detectChanges();
    expect(element.querySelector('.chip')).toBeNull();
  });
});
