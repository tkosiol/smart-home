import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { hasRole } from '@smart/contracts';
import { UiEmptyState, UiGrid, UiPage, UiSection, UiStack } from '@smart/ui';
import { HouseholdContext } from '../../core/household';
import { DeviceCard } from './device-card';
import { injectDeviceList } from './device-list';
import { NewHardware } from './new-hardware';

/**
 * The devices of the current household with their latest values, kept up to date; owners also see
 * the hardware the gateways found and add it.
 */
@Component({
  selector: 'app-devices-page',
  imports: [
    TranslocoPipe,
    DeviceCard,
    NewHardware,
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
        @if (devices.items().length > 0) {
          <ui-section [heading]="'devices.list.title' | transloco">
            <ui-grid>
              @for (device of devices.items(); track device.id) {
                <app-device-card [device]="device" />
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
  protected readonly devices = injectDeviceList();
  protected readonly isOwner = computed(() => {
    const role = this.household.current()?.role;
    return role !== undefined && hasRole(role, 'owner');
  });

  protected reload(): void {
    void this.devices.load(this.household.current()?.id, true);
  }
}
