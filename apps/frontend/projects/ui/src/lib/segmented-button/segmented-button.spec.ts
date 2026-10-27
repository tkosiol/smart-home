import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { UiOption } from '../option';
import { UiSegmentedButton } from './segmented-button';

type Mode = 'system' | 'light' | 'dark';

const MODES: readonly UiOption<Mode>[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Hell', icon: 'light_mode' },
  { value: 'dark', label: 'Dunkel', icon: 'dark_mode' },
];

@Component({
  imports: [UiSegmentedButton],
  template: `<ui-segmented-button label="Modus" [options]="options" [(value)]="mode" />`,
})
class Host {
  readonly options = MODES;
  readonly mode = signal<Mode | undefined>('system');
}

function render() {
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  const element = fixture.nativeElement as HTMLElement;
  return {
    fixture,
    host: fixture.componentInstance,
    element,
    radios: () => [...element.querySelectorAll<HTMLButtonElement>('[role="radio"]')],
  };
}

function press(target: HTMLElement, key: string): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

@Component({
  imports: [UiSegmentedButton],
  template: `<ui-segmented-button label="Modus" [options]="options" fullWidth value="light" />`,
})
class FullWidthHost {
  readonly options = MODES;
}

describe('UiSegmentedButton', () => {
  it('stretches across its container with fullWidth only', () => {
    const fixture = TestBed.createComponent(FullWidthHost);
    fixture.detectChanges();
    const group = (fixture.nativeElement as HTMLElement).querySelector('ui-segmented-button')!;
    expect(group.hasAttribute('data-full-width')).toBe(true);
    const plain = render();
    expect(
      plain.element.querySelector('ui-segmented-button')!.hasAttribute('data-full-width'),
    ).toBe(false);
  });

  it('is a named radio group of native buttons marking the bound option', () => {
    const { element, radios } = render();
    const group = element.querySelector('[role="radiogroup"]') as HTMLElement;
    expect(group.getAttribute('aria-label')).toBe('Modus');
    expect(element.querySelector('[class*="mat-"], [class*="mdc-"]')).toBeNull();
    expect(radios().every((radio) => radio.tagName === 'BUTTON')).toBe(true);
    expect(radios().map((radio) => radio.getAttribute('aria-checked'))).toEqual([
      'true',
      'false',
      'false',
    ]);
    expect(radios()[0]!.textContent).toContain('System');
    expect(radios()[1]!.querySelector('ui-icon')).not.toBeNull();
  });

  it('writes the chosen option back to the binding', () => {
    const { fixture, host, radios } = render();
    radios()[2]!.click();
    fixture.detectChanges();
    expect(host.mode()).toBe('dark');
    expect(radios().map((radio) => radio.getAttribute('aria-checked'))).toEqual([
      'false',
      'false',
      'true',
    ]);
  });

  it('keeps only the chosen segment in the tab order, or the first without a choice', () => {
    const { fixture, host, radios } = render();
    expect(radios().map((radio) => radio.tabIndex)).toEqual([0, -1, -1]);
    host.mode.set('dark');
    fixture.detectChanges();
    expect(radios().map((radio) => radio.tabIndex)).toEqual([-1, -1, 0]);
    host.mode.set(undefined);
    fixture.detectChanges();
    expect(radios().map((radio) => radio.tabIndex)).toEqual([0, -1, -1]);
  });

  it('moves the choice with the arrow keys and wraps around', () => {
    const { fixture, host, radios } = render();
    const [system, light, dark] = radios() as [
      HTMLButtonElement,
      HTMLButtonElement,
      HTMLButtonElement,
    ];
    system.focus();
    press(system, 'ArrowRight');
    fixture.detectChanges();
    expect(host.mode()).toBe('light');
    expect(document.activeElement).toBe(light);
    press(light, 'ArrowDown');
    fixture.detectChanges();
    expect(host.mode()).toBe('dark');
    press(dark, 'ArrowRight');
    fixture.detectChanges();
    expect(host.mode()).toBe('system');
    expect(document.activeElement).toBe(system);
    press(system, 'ArrowLeft');
    fixture.detectChanges();
    expect(host.mode()).toBe('dark');
    press(dark, 'Home');
    fixture.detectChanges();
    expect(host.mode()).toBe('system');
    press(system, 'End');
    fixture.detectChanges();
    expect(host.mode()).toBe('dark');
    expect(document.activeElement).toBe(dark);
  });

  it('leaves other keys to the page', () => {
    const { fixture, host, radios } = render();
    const system = radios()[0]!;
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    system.dispatchEvent(event);
    fixture.detectChanges();
    expect(event.defaultPrevented).toBe(false);
    expect(host.mode()).toBe('system');
  });
});

@Component({
  imports: [UiSegmentedButton],
  template: `<ui-segmented-button
    label="Modus"
    [options]="options"
    [(value)]="mode"
    [disabled]="true"
  />`,
})
class DisabledHost {
  readonly options = MODES;
  readonly mode = signal<Mode>('system');
}

describe('UiSegmentedButton when disabled', () => {
  it('disables every segment and keeps the value when one is clicked', () => {
    const fixture = TestBed.createComponent(DisabledHost);
    fixture.detectChanges();
    const buttons = fixture.nativeElement.querySelectorAll(
      'button',
    ) as NodeListOf<HTMLButtonElement>;
    expect(buttons.length).toBe(3);
    expect(Array.from(buttons).every((button) => button.disabled)).toBe(true);
    buttons[2]!.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.mode()).toBe('system');
  });
});
