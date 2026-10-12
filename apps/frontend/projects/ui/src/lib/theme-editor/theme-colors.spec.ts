import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { DEFAULT_INSTANCE_APPEARANCE, type Language, type ThemeColors } from '@smart/contracts';
import { deriveKeyColors } from '@smart/theme';
import { provideUiTranslocoTesting } from '../testing/i18n-testing';
import { UiThemeColors } from './theme-colors';

@Component({
  imports: [UiThemeColors],
  template: `<ui-theme-colors [(colors)]="colors" />`,
})
class Host {
  readonly colors = signal<ThemeColors>(DEFAULT_INSTANCE_APPEARANCE.colors);
}

async function setup(language: Language = 'de') {
  TestBed.configureTestingModule({
    providers: [
      provideUiTranslocoTesting(language),
      { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
    ],
  });
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  const element = fixture.nativeElement as HTMLElement;
  const refresh = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  return { fixture, host: fixture.componentInstance, element, refresh };
}

const swatch = (element: HTMLElement, name: string) =>
  element.querySelector(`button[aria-label="${name}"]`) as HTMLButtonElement;
const toggle = (element: HTMLElement, label: string) =>
  [...element.querySelectorAll('mat-slide-toggle')]
    .find((candidate) => candidate.textContent?.includes(label))!
    .querySelector('button') as HTMLButtonElement;

describe('UiThemeColors', () => {
  it('marks the suggestion matching the seed and applies a chosen one', async () => {
    const { host, element, refresh } = await setup();
    expect(swatch(element, 'Petrol').getAttribute('aria-pressed')).toBe('true');
    swatch(element, 'Pflaume').click();
    await refresh();
    expect(host.colors().seed).toBe('#6e4c7e');
    expect(swatch(element, 'Pflaume').getAttribute('aria-pressed')).toBe('true');
    expect(swatch(element, 'Petrol').getAttribute('aria-pressed')).toBe('false');
  });

  it('shows derived key colors that follow the seed', async () => {
    const { host, element, refresh } = await setup();
    const derived = () => deriveKeyColors(host.colors()).secondary.hex;
    expect(element.textContent).toContain(`Abgeleitet: ${derived()}`);
    swatch(element, 'Bernstein').click();
    await refresh();
    expect(element.textContent).toContain(`Abgeleitet: ${derived()}`);
  });

  it('starts an override at the derived value and removes it again', async () => {
    const { host, element, refresh } = await setup();
    const derived = deriveKeyColors(host.colors()).tertiary.hex;
    toggle(element, 'Tertiär anpassen').click();
    await refresh();
    expect(host.colors().coreOverrides.tertiary).toBe(derived);
    expect(
      [...element.querySelectorAll('mat-label')].map((label) => label.textContent?.trim()),
    ).toContain('Tertiär');
    expect(element.textContent).not.toContain(`Abgeleitet: ${derived}`);
    toggle(element, 'Tertiär anpassen').click();
    await refresh();
    expect(host.colors().coreOverrides.tertiary).toBeUndefined();
  });

  it('ignores an invalid color while typing', async () => {
    const { host, element, refresh } = await setup();
    const seedInput = element.querySelector('input[type="text"]') as HTMLInputElement;
    seedInput.value = '#zz';
    seedInput.dispatchEvent(new Event('input'));
    await refresh();
    expect(host.colors().seed).toBe(DEFAULT_INSTANCE_APPEARANCE.colors.seed);
  });

  it('explains the variant while color match is on', async () => {
    const { host, element, refresh } = await setup();
    expect(element.textContent).not.toContain('nur die abgeleiteten Farben');
    toggle(element, 'Farbtreue').click();
    await refresh();
    expect(host.colors().colorMatch).toBe(true);
    expect(element.textContent).toContain('nur die abgeleiteten Farben');
  });

  it('keeps working with a gray override', async () => {
    const { host, element, refresh } = await setup();
    host.colors.set({ ...host.colors(), coreOverrides: { neutral: '#808080' } });
    await refresh();
    expect(toggle(element, 'Neutral anpassen').getAttribute('aria-checked')).toBe('true');
  });

  it('speaks English', async () => {
    const { element } = await setup('en');
    expect(element.textContent).toContain('Seed color');
    expect(toggle(element, 'Customize Tertiary')).toBeTruthy();
  });
});
