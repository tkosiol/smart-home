import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { isLowBattery, primaryCapability, type Device } from '@smart/contracts';
import { UiButton, UiCard, UiCardActions, UiRelativeTimePipe, UiStack } from '@smart/ui';
import { DeviceReading } from './device-reading';
import { batteryPercent } from './device-values';

/**
 * One device at a glance: its main value and battery, when it last reported, and a hint while it
 * is offline or its battery is low. The state of the device is said in words, not by colour.
 */
@Component({
  selector: 'app-device-card',
  imports: [
    TranslocoPipe,
    DeviceReading,
    UiButton,
    UiCard,
    UiCardActions,
    UiRelativeTimePipe,
    UiStack,
  ],
  template: `
    <ui-card [heading]="device().name">
      <ui-stack gap="sm">
        @if (primary(); as capability) {
          <p>
            <app-device-reading
              [capability]="capability"
              [value]="device().state[capability.key]"
            />
          </p>
        }
        @if (battery(); as capability) {
          <p>
            <app-device-reading [capability]="capability" [value]="device().state['battery']" />
          </p>
        }
        @if (lowBattery()) {
          <p>{{ 'devices.card.lowBattery' | transloco }}</p>
        }
        @if (device().availability === 'offline') {
          <p>{{ 'devices.card.offline' | transloco }}</p>
        }
        <p>
          @if (device().lastSeenAt) {
            {{
              'devices.card.lastSeen' | transloco: { time: device().lastSeenAt | uiRelativeTime }
            }}
          } @else {
            {{ 'devices.card.neverSeen' | transloco }}
          }
        </p>
      </ui-stack>
      <div uiCardActions>
        <ui-button variant="text" [route]="'/geraete/' + device().id">{{
          'devices.card.details' | transloco
        }}</ui-button>
      </div>
    </ui-card>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeviceCard {
  readonly device = input.required<Device>();

  /** The main value; the battery has its own line, so it is not repeated here. */
  protected readonly primary = computed(() => {
    const capability = primaryCapability(this.device().capabilities);
    return capability?.key === 'battery' ? undefined : capability;
  });
  protected readonly battery = computed(() =>
    this.device().capabilities.find((capability) => capability.key === 'battery'),
  );
  protected readonly lowBattery = computed(() => isLowBattery(batteryPercent(this.device())));
}
