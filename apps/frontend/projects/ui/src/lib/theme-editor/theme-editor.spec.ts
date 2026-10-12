import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import {
  DEFAULT_INSTANCE_APPEARANCE,
  DEFAULT_PERSONAL_APPEARANCE,
  type InstanceAppearance,
  type Language,
  type PersonalAppearance,
} from '@smart/contracts';
import { provideUiTranslocoTesting } from '../testing/i18n-testing';
import { UiThemeEditor, type UiThemeEditorMode } from './theme-editor';

@Component({
  imports: [UiThemeEditor],
  template: `<ui-theme-editor
    [mode]="mode()"
    [(instance)]="instance"
    [(personal)]="personal"
    (resetRequested)="resets.set(resets() + 1)"
  />`,
})
class Host {
  readonly mode = signal<UiThemeEditorMode>('personal');
  readonly instance = signal<InstanceAppearance>(DEFAULT_INSTANCE_APPEARANCE);
  readonly personal = signal<PersonalAppearance>(DEFAULT_PERSONAL_APPEARANCE);
  readonly resets = signal(0);
}

async function setup(mode: UiThemeEditorMode, language: Language = 'de') {
  TestBed.configureTestingModule({
    providers: [
      provideUiTranslocoTesting(language),
      { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
    ],
  });
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.mode.set(mode);
  const refresh = async () => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  await refresh();
  const element = fixture.nativeElement as HTMLElement;
  /** Opens the select labelled `label` and picks the option `option`. */
  const choose = async (label: string, option: string) => {
    const field = [...element.querySelectorAll('ui-select')].find((candidate) =>
      candidate.querySelector('mat-label')?.textContent?.includes(label),
    )!;
    (field.querySelector('[role="combobox"]') as HTMLElement).click();
    await refresh();
    (
      [...document.querySelectorAll('mat-option')].find((candidate) =>
        candidate.textContent?.includes(option),
      ) as HTMLElement
    ).click();
    await refresh();
  };
  const toggle = (label: string) =>
    [...element.querySelectorAll('mat-slide-toggle')]
      .find((candidate) => candidate.textContent?.includes(label))!
      .querySelector('button') as HTMLButtonElement;
  const radio = (label: string) =>
    [...element.querySelectorAll('mat-button-toggle button')].find((candidate) =>
      candidate.textContent?.includes(label),
    ) as HTMLButtonElement;
  const labels = () =>
    [...element.querySelectorAll('mat-label')].map((label) => label.textContent?.trim());
  return { host: fixture.componentInstance, element, refresh, choose, toggle, radio, labels };
}

describe('UiThemeEditor in personal mode', () => {
  it('offers mode, contrast and own colors, but not shape and font', async () => {
    const { element, labels } = await setup('personal');
    expect(element.querySelector('mat-button-toggle-group')?.getAttribute('aria-label')).toBe(
      'Modus',
    );
    expect(labels()).toContain('Kontrast');
    expect(labels()).not.toContain('Formen');
    expect(labels()).not.toContain('Schrift');
    expect(element.textContent).toContain('Es gelten die Farben der Installation.');
  });

  it('writes mode and contrast to the personal appearance', async () => {
    const { host, refresh, choose, radio, element } = await setup('personal');
    expect(element.textContent).toContain('wenn das Gerät mehr Kontrast verlangt');
    radio('Dunkel').click();
    await refresh();
    await choose('Kontrast', 'Hoch');
    expect(host.personal()).toEqual({ mode: 'dark', contrast: 'high' });
    expect(element.textContent).not.toContain('wenn das Gerät mehr Kontrast verlangt');
  });

  it('starts own colors from the installation colors and drops them again', async () => {
    const { host, refresh, toggle, element } = await setup('personal');
    toggle('Eigene Farben').click();
    await refresh();
    expect(host.personal().colors).toEqual(DEFAULT_INSTANCE_APPEARANCE.colors);
    expect(element.querySelector('ui-theme-colors')).not.toBeNull();
    toggle('Eigene Farben').click();
    await refresh();
    expect(host.personal().colors).toBeUndefined();
    expect(host.instance()).toEqual(DEFAULT_INSTANCE_APPEARANCE);
  });

  it('asks the host to reset', async () => {
    const { host, element, refresh } = await setup('personal');
    const reset = [...element.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Auf Standard zurücksetzen'),
    )!;
    reset.click();
    await refresh();
    expect(host.resets()).toBe(1);
  });

  it('speaks English', async () => {
    const { element, labels } = await setup('personal', 'en');
    expect(element.querySelector('mat-button-toggle-group')?.getAttribute('aria-label')).toBe(
      'Mode',
    );
    expect(labels()).toContain('Contrast');
  });
});

describe('UiThemeEditor in instance mode', () => {
  it('edits colors, shape and font of the installation, but no personal settings', async () => {
    const { host, element, choose, refresh } = await setup('instance');
    expect(element.querySelector('mat-button-toggle-group')).toBeNull();
    await choose('Formen', 'Weich');
    await choose('Schrift', 'Figtree');
    (element.querySelector('button[aria-label="Pflaume"]') as HTMLButtonElement).click();
    await refresh();
    expect(host.instance()).toEqual({
      ...DEFAULT_INSTANCE_APPEARANCE,
      colors: { ...DEFAULT_INSTANCE_APPEARANCE.colors, seed: '#6e4c7e' },
      shape: 'weich',
      font: 'figtree',
    });
    expect(host.personal()).toEqual(DEFAULT_PERSONAL_APPEARANCE);
  });
});
