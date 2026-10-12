import { DOCUMENT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { SwUpdate, type VersionEvent } from '@angular/service-worker';
import { Subject } from 'rxjs';
import { AppUpdates } from './app-updates';

describe('AppUpdates', () => {
  function setup(isEnabled = true) {
    const versionUpdates = new Subject<VersionEvent>();
    const reload = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: SwUpdate, useValue: { isEnabled, versionUpdates } },
        { provide: DOCUMENT, useValue: { location: { reload } } },
      ],
    });
    return { versionUpdates, reload, updates: TestBed.inject(AppUpdates) };
  }

  const ready = {
    type: 'VERSION_READY',
    currentVersion: { hash: 'a' },
    latestVersion: { hash: 'b' },
  } as VersionEvent;

  it('is not ready until the service worker has a new version', () => {
    const { versionUpdates, updates } = setup();
    expect(updates.updateReady()).toBe(false);

    versionUpdates.next({ type: 'VERSION_DETECTED', version: { hash: 'b' } });
    expect(updates.updateReady()).toBe(false);

    versionUpdates.next(ready);
    expect(updates.updateReady()).toBe(true);
  });

  it('stays false while the service worker is disabled', () => {
    const { versionUpdates, updates } = setup(false);
    versionUpdates.next(ready);
    expect(updates.updateReady()).toBe(false);
  });

  it('reloads the page', () => {
    const { reload, updates } = setup();
    updates.reload();
    expect(reload).toHaveBeenCalledOnce();
  });
});
