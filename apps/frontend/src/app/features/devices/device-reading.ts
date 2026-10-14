import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import type { Capability } from '@smart/contracts';
import { UiFormatContext } from '@smart/ui/shell';
import { CapabilityLabel } from './capability-label';
import { formatReading } from './device-values';

/**
 * "Label: value" of one capability. A value that is not there yet shows a dash that screen readers
 * read as "noch keine Werte".
 */
@Component({
  selector: 'app-device-reading',
  imports: [CapabilityLabel, TranslocoPipe],
  template: `<app-capability-label [key]="capability().key" />:
    @if (view(); as reading) {
      @switch (reading.kind) {
        @case ('missing') {
          <span role="img" [attr.aria-label]="'devices.reading.none' | transloco">–</span>
        }
        @case ('binary') {
          @switch (reading.style) {
            @case ('dry') {
              @if (reading.on) {
                {{ 'devices.reading.dry' | transloco }}
              } @else {
                {{ 'devices.reading.notDry' | transloco }}
              }
            }
            @case ('power') {
              @if (reading.on) {
                {{ 'devices.reading.on' | transloco }}
              } @else {
                {{ 'devices.reading.off' | transloco }}
              }
            }
            @default {
              @if (reading.on) {
                {{ 'devices.reading.yes' | transloco }}
              } @else {
                {{ 'devices.reading.no' | transloco }}
              }
            }
          }
        }
        @case ('text') {
          {{ reading.text }}
        }
      }
    }`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeviceReading {
  readonly capability = input.required<Capability>();
  readonly value = input<unknown>();

  private readonly format = inject(UiFormatContext);
  protected readonly view = computed(() =>
    formatReading(this.capability(), this.value(), this.format.locale()),
  );
}
