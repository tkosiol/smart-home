import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import {
  UiButton,
  UiDevicePod,
  UiEmptyState,
  UiEmptyStateActions,
  UiFormatContext,
  UiPodRow,
  UiRoomCard,
} from '@smart/ui';
import { injectDeviceList } from './device-list';
import { podOf } from './device-pod';
import { provideDevicesTexts } from './devices-texts';

/**
 * The overview's block "Geräte": a pod for every device (a link to its page), wrapping rather than
 * scrolling (spec 3.1), kept up to date. Before rooms exist it takes the room card's place: the
 * heading leads to the devices page, the head says how many devices there are. Loaded lazily.
 */
@Component({
  selector: 'app-devices-block',
  imports: [
    TranslocoPipe,
    UiButton,
    UiDevicePod,
    UiEmptyState,
    UiEmptyStateActions,
    UiPodRow,
    UiRoomCard,
  ],
  providers: [provideDevicesTexts()],
  template: `
    <ui-room-card
      [heading]="'devices.block.title' | transloco"
      route="/geraete"
      [summary]="
        pods().length === 0
          ? null
          : {
              text:
                pods().length === 1
                  ? ('devices.block.countOne' | transloco)
                  : ('devices.block.count' | transloco: { n: pods().length }),
            }
      "
    >
      @if (pods().length > 0) {
        <ui-pod-row wrap>
          @for (pod of pods(); track pod.route) {
            <ui-device-pod
              [kind]="pod.kind"
              [icon]="pod.icon"
              [value]="pod.valueKey ? (pod.valueKey | transloco) : pod.value"
              [unit]="pod.unit"
              [label]="pod.label"
              [chip]="pod.chip ? { text: (pod.chip.key | transloco), tone: pod.chip.tone } : null"
              [route]="pod.route"
            />
          }
        </ui-pod-row>
      } @else if (devices.loaded()) {
        <ui-empty-state
          icon="devices"
          [level]="3"
          [heading]="'devices.empty.heading' | transloco"
          [description]="'devices.empty.description' | transloco"
        >
          <div uiEmptyStateActions>
            <ui-button route="/geraete">{{ 'devices.empty.action' | transloco }}</ui-button>
          </div>
        </ui-empty-state>
      }
    </ui-room-card>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DevicesBlock {
  protected readonly devices = injectDeviceList();
  private readonly locale = inject(UiFormatContext).locale;

  protected readonly pods = computed(() =>
    this.devices.items().map((device) => podOf(device, this.locale())),
  );
}
