import { DOCUMENT, DestroyRef, Injectable, Injector, afterNextRender, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { Router, RouterStateSnapshot, TitleStrategy } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import type { Subscription } from 'rxjs';

const PRODUCT_NAME = 'Smart Home';
const HEADING_WAIT_MS = 3000;

/**
 * The document title names the page ("Räume – Smart Home") in the active language, and after a
 * navigation the view starts at the top and the focus moves to the page heading: together they tell
 * a screen reader user that the page changed (WCAG 2.4.2). A route's `title` is a root translation
 * key.
 *
 * The router's own scroll handling (`withInMemoryScrolling`) would cost about 4 kB of the initial
 * bundle, so this does the part that matters: forward navigations scroll to the top, back and
 * forward are left to the browser's scroll restoration.
 */
@Injectable({ providedIn: 'root' })
export class PageTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);
  private readonly transloco = inject(TranslocoService);
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private following?: Subscription;
  private stopWatching?: () => void;
  private firstPage = true;

  constructor() {
    super();
    inject(DestroyRef).onDestroy(() => {
      this.following?.unsubscribe();
      this.stopWatching?.();
    });
  }

  override updateTitle(snapshot: RouterStateSnapshot): void {
    this.following?.unsubscribe();
    const key = this.buildTitle(snapshot);
    if (key) {
      // Also fires when the language changes or its texts arrive.
      this.following = this.transloco.selectTranslate(key).subscribe((text) => {
        this.title.setTitle(text === key ? PRODUCT_NAME : `${text} – ${PRODUCT_NAME}`);
      });
    } else {
      this.title.setTitle(PRODUCT_NAME);
    }
    // The first page keeps scroll and focus where the browser put them.
    if (!this.firstPage) {
      // The router needs this strategy, so it is only asked for once a navigation runs.
      if (this.injector.get(Router).getCurrentNavigation()?.trigger !== 'popstate') {
        this.document.defaultView?.scrollTo(0, 0);
      }
      this.focusHeading();
    }
    this.firstPage = false;
  }

  /**
   * Once the new page is rendered. A page waits for its texts before it shows a heading, so this
   * watches for it for a moment, unless the user has moved the focus on by then.
   */
  private focusHeading(): void {
    this.stopWatching?.();
    afterNextRender(
      () => {
        const before = this.document.activeElement;
        const done = (): boolean => {
          if (this.document.activeElement !== before) return true;
          const heading = this.document.querySelector<HTMLElement>('main h1');
          heading?.focus({ preventScroll: true });
          return heading !== null;
        };
        const main = this.document.querySelector('main');
        if (done() || !main) return;
        const observer = new MutationObserver(() => done() && stop());
        const timer = setTimeout(() => stop(), HEADING_WAIT_MS);
        const stop = (): void => {
          observer.disconnect();
          clearTimeout(timer);
          this.stopWatching = undefined;
        };
        observer.observe(main, { childList: true, subtree: true });
        this.stopWatching = stop;
      },
      { injector: this.injector },
    );
  }
}
