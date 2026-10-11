import { Pipe, inject, type PipeTransform } from '@angular/core';
import { UiClock } from './clock';
import { UiFormatContext } from './format-context';
import { formatRelativeTime } from './formatters';

/** `instant | uiRelativeTime` – "vor 5 Minuten", "gestern"; updates as the clock ticks. */
@Pipe({ name: 'uiRelativeTime', pure: false })
export class UiRelativeTimePipe implements PipeTransform {
  private readonly context = inject(UiFormatContext);
  private readonly clock = inject(UiClock);

  transform(value: string | null | undefined): string {
    return formatRelativeTime(
      value,
      this.clock.now(),
      this.context.locale(),
      this.context.timeZone(),
    );
  }
}
