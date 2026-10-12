import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { App } from './app';
import { provideI18n } from './core/i18n';

describe('App', () => {
  it('renders the app shell', async () => {
    TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([]),
        provideI18n(),
        provideServiceWorker('ngsw-worker.js', { enabled: false }),
      ],
    });
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;

    expect(host.querySelector('app-shell')).not.toBeNull();
    expect(host.children.length).toBe(1);
  });
});
