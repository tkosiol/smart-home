import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

const MAX_COUNT = 99;

/**
 * Puts a count over its content (M3 large badge): nothing for 0, the number up to 99, then "99+".
 * The number is hidden from assistive technology; the surrounding control names it.
 */
@Component({
  selector: 'ui-badge',
  templateUrl: './badge.html',
  styleUrl: './badge.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UiBadge {
  readonly count = input.required<number>();

  protected readonly label = computed(() => {
    const count = this.count();
    if (count <= 0) return null;
    return count > MAX_COUNT ? `${MAX_COUNT}+` : String(count);
  });
}
