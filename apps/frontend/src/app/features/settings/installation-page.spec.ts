import { TestBed } from '@angular/core/testing';
import { DEFAULT_RUNTIME_CONFIG } from '@smart/contracts';
import { APPEARANCE_STORE, MemoryAppearanceStore, ThemeService } from '@smart/ui';
import { provideRuntimeConfig } from '../../core/config';
import { settle, setupPage } from '../../testing/page-testing';
import { settingsRoutes } from './settings.routes';

describe('installation page', () => {
  afterEach(() => document.documentElement.removeAttribute('style'));

  async function open() {
    const harness = await setupPage(
      [{ path: 'mehr/einstellungen', loadChildren: () => settingsRoutes }],
      'de',
      [
        provideRuntimeConfig({
          ...DEFAULT_RUNTIME_CONFIG,
          features: { instanceAppearanceEditor: true },
        }),
        { provide: APPEARANCE_STORE, useValue: new MemoryAppearanceStore() },
      ],
    );
    await harness.navigateByUrl('/mehr/einstellungen/installation');
    await settle(harness);
    return harness.routeNativeElement as HTMLElement;
  }

  it('edits the instance appearance and resets it to the installation default', async () => {
    const element = await open();
    const theme = TestBed.inject(ThemeService);
    const setInstance = vi.spyOn(theme, 'setInstance');
    const resetInstance = vi.spyOn(theme, 'resetInstance');

    expect(element.querySelector('ui-theme-editor')).not.toBeNull();
    // Instance mode: shape and font are offered, own colors are not.
    expect(element.textContent).toContain('Formen');
    expect(element.textContent).not.toContain('Eigene Farben');

    const reset = [...element.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Auf Standard zurücksetzen'),
    )!;
    reset.click();
    expect(resetInstance).toHaveBeenCalledOnce();
    expect(setInstance).not.toHaveBeenCalled();
  });
});
