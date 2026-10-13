import type { UiOption } from '@smart/ui';

/** The zone the browser is in; the default for a new household. */
export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Every zone the browser knows, for a select. `include` is added when the browser does not list
 * it (`UTC` is missing in some, and a household may carry a zone this browser does not know).
 */
export function timeZoneOptions(...include: readonly string[]): readonly UiOption<string>[] {
  const zones = new Set<string>([...Intl.supportedValuesOf('timeZone'), 'UTC', ...include]);
  return [...zones].sort().map((zone) => ({ value: zone, label: zone.replaceAll('_', ' ') }));
}
