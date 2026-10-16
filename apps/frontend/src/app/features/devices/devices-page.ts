import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { hasRole } from '@smart/contracts';
import {
  UiDevicePod,
  UiEmptyState,
  UiFormatContext,
  UiGrid,
  UiPage,
  UiSection,
  UiStack,
} from '@smart/ui';
import { HouseholdContext } from '../../core/household';
import { injectDeviceList } from './device-list';
import { podOf } from './device-pod';
import { NewHardware } from './new-hardware';

/**
 * The devices of the current household as a grid of pods (spec 3.6), each a link to its page,
 * kept up to date; owners also see the hardware the gateways found and add it.
 */
@Component({
  selector: 'app-devices-page',
  imports: [
    TranslocoPipe,
    NewHardware,
    UiDevicePod,
    UiEmptyState,
    UiGrid,
    UiPage,
    UiSection,
    UiStack,
  ],
  template: `
    <ui-page [heading]="'devices.title' | transloco">
      <ui-stack gap="xl">
        @if (isOwner()) {
          <app-new-hardware (added)="reload()" />
        }
        @if (pods().length > 0) {
          <ui-section [heading]="'devices.list.title' | transloco">
            <ui-grid min="sm" gap="sm">
              @for (pod of pods(); track pod.route) {
                <ui-device-pod
                  fill
                  [kind]="pod.kind"
                  [icon]="pod.icon"
                  [value]="pod.valueKey ? (pod.valueKey | transloco) : pod.value"
                  [unit]="pod.unit"
                  [label]="pod.label"
                  [chip]="
                    pod.chip ? { text: (pod.chip.key | transloco), tone: pod.chip.tone } : null
                  "
                  [route]="pod.route"
                />
              }
            </ui-grid>
          </ui-section>
        } @else if (devices.loaded()) {
          <ui-empty-state
            icon="devices"
            [heading]="'devices.empty.heading' | transloco"
            [description]="'devices.empty.description' | transloco"
          />
        }
      </ui-stack>
    </ui-page>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DevicesPage {
  private readonly household = inject(HouseholdContext);
  private readonly locale = inject(UiFormatContext).locale;
  protected readonly devices = injectDeviceList();
  protected readonly pods = computed(() =>
    this.devices.items().map((device) => podOf(device, this.locale())),
  );
  protected readonly isOwner = computed(() => {
    const role = this.household.current()?.role;
    return role !== undefined && hasRole(role, 'owner');
  });

  protected reload(): void {
    void this.devices.load(this.household.current()?.id, true);
  }
}
