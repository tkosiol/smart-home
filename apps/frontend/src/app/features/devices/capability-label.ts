import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { capabilityLabelKey } from './device-values';

/** The name of a capability: known keys in the page language, any other key as it is. */
@Component({
  selector: 'app-capability-label',
  imports: [TranslocoPipe],
  template: `@if (labelKey(); as labelKey) {
      <ng-container>{{ labelKey | transloco }}</ng-container>
    } @else {
      <ng-container>{{ key() }}</ng-container>
    }`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CapabilityLabel {
  readonly key = input.required<string>();
  protected readonly labelKey = computed(() => capabilityLabelKey(this.key()));
}
