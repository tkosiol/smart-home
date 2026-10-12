import { Pipe, inject, type PipeTransform } from '@angular/core';
import { UiFormatContext } from './format-context';
import { formatDateTime, type UiDateTimeStyle } from './formatters';

/** `instant | uiDateTime: 'medium'` – UTC instant shown in the household time zone (spec §9). */
@Pipe({ name: 'uiDateTime', pure: false })
export class UiDateTimePipe implements PipeTransform {
  private readonly context = inject(UiFormatContext);

  transform(value: string | null | undefined, style: UiDateTimeStyle = 'medium'): string {
    return formatDateTime(value, style, this.context.locale(), this.context.timeZone());
  }
}
