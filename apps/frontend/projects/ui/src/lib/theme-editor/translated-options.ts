import { computed, type Signal } from '@angular/core';
import { translateSignal } from '@jsverse/transloco';
import type { UiOption } from '../option';

/** Options whose labels follow the active language. Call in an injection context (field initializer). */
export function translatedOptions<T extends string>(
  values: readonly T[],
  keys: Record<T, string>,
): Signal<UiOption<T>[]> {
  const labels = translateSignal(values.map((value) => keys[value]));
  return computed(() => values.map((value, index) => ({ value, label: labels()[index] ?? value })));
}
