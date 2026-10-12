import { DOCUMENT, DestroyRef, Injectable, Injector, afterNextRender, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { Router, RouterStateSnapshot, TitleStrategy } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import type { Subscription } from 'rxjs';

const PRODUCT_NAME = 'Smart Home';

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
  private firstPage = true;

  constructor() {
    super();
    inject(DestroyRef).onDestroy(() => this.following?.unsubscribe());
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
      afterNextRender(
        () => this.document.querySelector<HTMLElement>('main h1')?.focus({ preventScroll: true }),
        { injector: this.injector },
      );
    }
    this.firstPage = false;
  }
}
