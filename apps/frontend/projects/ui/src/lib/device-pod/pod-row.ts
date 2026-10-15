import { BreakpointObserver } from '@angular/cdk/layout';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  booleanAttribute,
  computed,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TRANSLOCO_SCOPE, TranslocoPipe } from '@jsverse/transloco';
import { map } from 'rxjs';
import { MEDIUM } from '../adaptive-shell/adaptive-shell';
import { UiIconButton } from '../button/icon-button';
import { MEDIA_QUERIES } from '../theme/media-queries';

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

/**
 * A row of `ui-device-pod`s (spec 3.1): scrolls sideways with snapping, each pod is reached with
 * Tab and scrolls into view when focused; from medium windows up two arrows page the row, shown
 * only while the row really scrolls and disabled at the end it has reached. With `wrap` the pods
 * wrap instead (the devices block, medium windows).
 */
@Component({
  selector: 'ui-pod-row',
  imports: [TranslocoPipe, UiIconButton],
  templateUrl: './pod-row.html',
  styleUrl: './pod-row.scss',
  // Own texts (`ui.*`) only; a page's lazy Transloco scope must not prefix them.
  providers: [{ provide: TRANSLOCO_SCOPE, useValue: null }],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-wrap]': "wrap() ? '' : null" },
})
export class UiPodRow {
  readonly wrap = input(false, { transform: booleanAttribute });

  private readonly scroller = viewChild.required<ElementRef<HTMLElement>>('scroller');
  private readonly media = inject(MEDIA_QUERIES);
  private readonly medium = toSignal(
    inject(BreakpointObserver)
      .observe(MEDIUM)
      .pipe(map((state) => state.matches)),
    { initialValue: false },
  );

  private readonly overflowing = signal(false);
  protected readonly atStart = signal(true);
  protected readonly atEnd = signal(true);

  protected readonly arrows = computed(() => this.medium() && !this.wrap() && this.overflowing());

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      this.measure();
      if (typeof ResizeObserver === 'undefined') return;
      // The row's own box changes with the window; its pods change its content width.
      const scroller = this.scroller().nativeElement;
      const resize = new ResizeObserver(() => this.measure());
      const observeAll = () => {
        resize.disconnect();
        resize.observe(scroller);
        for (const pod of Array.from(scroller.children)) resize.observe(pod);
      };
      observeAll();
      const mutation = new MutationObserver(() => {
        observeAll();
        this.measure();
      });
      mutation.observe(scroller, { childList: true });
      destroyRef.onDestroy(() => {
        resize.disconnect();
        mutation.disconnect();
      });
    });
  }

  /** Reads the scroll position and whether the pods overflow the row. */
  protected measure(): void {
    const { scrollWidth, clientWidth, scrollLeft } = this.scroller().nativeElement;
    this.overflowing.set(scrollWidth > clientWidth);
    // `scrollLeft` is negative in right-to-left writing; one pixel of slack for fractions.
    this.atStart.set(Math.abs(scrollLeft) < 1);
    this.atEnd.set(Math.abs(scrollLeft) + clientWidth >= scrollWidth - 1);
  }

  protected page(direction: -1 | 1): void {
    const scroller = this.scroller().nativeElement;
    scroller.scrollBy({
      left: direction * scroller.clientWidth,
      behavior: this.media.matches(REDUCED_MOTION) ? 'auto' : 'smooth',
    });
  }

  /** The browser scrolls a focused pod into view by itself; snapping can leave it half hidden. */
  protected bringIntoView(event: FocusEvent): void {
    const target = event.target;
    if (target instanceof HTMLElement) {
      target.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }
  }
}
