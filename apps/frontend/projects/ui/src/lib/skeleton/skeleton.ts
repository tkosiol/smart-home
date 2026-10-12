import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  numberAttribute,
} from '@angular/core';

/** Placeholder while content loads; hidden from assistive technology (announce loading around it). */
@Component({
  selector: 'ui-skeleton',
  templateUrl: './skeleton.html',
  styleUrl: './skeleton.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true', '[attr.data-variant]': 'variant()' },
})
export class UiSkeleton {
  readonly variant = input<'text' | 'block' | 'circle'>('text');
  readonly lines = input(1, { transform: numberAttribute });

  protected readonly lineIndexes = computed(() =>
    Array.from({ length: Math.max(1, Math.floor(this.lines())) }, (_, index) => index),
  );
}
