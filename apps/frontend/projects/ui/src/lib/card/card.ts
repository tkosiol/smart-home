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
} from '@angular/material/card';

/** Marks the element holding a card's actions (buttons). */
@Directive({ selector: '[uiCardActions]' })
export class UiCardActions {}

/** M3 card; the heading is an h3 because cards sit inside page sections (h1/h2). */
@Component({
  selector: 'ui-card',
  imports: [MatCard, MatCardHeader, MatCardTitle, MatCardSubtitle, MatCardContent, MatCardActions],
  templateUrl: './card.html',
  styleUrl: './card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UiCard {
  readonly variant = input<'filled' | 'outlined' | 'elevated'>('outlined');
  readonly heading = input<string>();
  readonly subheading = input<string>();

  protected readonly actions = contentChild(UiCardActions);
  protected readonly appearance = computed(() =>
    this.variant() === 'elevated' ? 'raised' : this.variant(),
  );
}
