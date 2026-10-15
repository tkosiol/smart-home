import {
  ChangeDetectionStrategy,
  Component,
  Directive,
  computed,
  contentChild,
  input,
} from '@angular/core';
import {
  MatCard,
  MatCardActions,
  MatCardContent,
  MatCardHeader,
  MatCardSubtitle,
  MatCardTitle,
  type MatCardAppearance,
} from '@angular/material/card';

/**
 * `low` is the card of the design concept (spec 2.1, 2.2, 3.6): surface-container-low, extra-large
 * corners, the heading in title-large with weight 600. The others are Material's appearances.
 */
export type UiCardVariant = 'filled' | 'outlined' | 'elevated' | 'low';

/** Maps each card variant to the Material appearance; `elevated` is Material's `raised`. */
const APPEARANCE: Record<UiCardVariant, MatCardAppearance> = {
  filled: 'filled',
  outlined: 'outlined',
  elevated: 'raised',
  low: 'filled',
};

/** Marks the element holding a card's actions (buttons). */
@Directive({ selector: '[uiCardActions]' })
export class UiCardActions {}

/** M3 card; the heading is an h3 by default because cards sit inside page sections (h1/h2). */
@Component({
  selector: 'ui-card',
  imports: [MatCard, MatCardHeader, MatCardTitle, MatCardSubtitle, MatCardContent, MatCardActions],
  templateUrl: './card.html',
  styleUrl: './card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-variant]': 'variant()' },
})
export class UiCard {
  readonly variant = input<UiCardVariant>('outlined');
  readonly heading = input<string>();
  readonly description = input<string>();
  readonly level = input<2 | 3>(3);

  protected readonly actions = contentChild(UiCardActions);
  protected readonly appearance = computed(() => APPEARANCE[this.variant()]);
}
