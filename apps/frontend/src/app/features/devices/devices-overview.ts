import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiEmptyState, UiGrid } from '@smart/ui';
import { DeviceCard } from './device-card';
import { injectDeviceList } from './device-list';
import { provideDevicesTexts } from './devices-texts';

/** The overview's cards of the devices: one per device, kept up to date. Loaded lazily. */
@Component({
  selector: 'app-devices-overview',
  imports: [TranslocoPipe, DeviceCard, UiEmptyState, UiGrid],
  providers: [provideDevicesTexts()],
  template: `
    @if (devices.items().length > 0) {
      <ui-grid>
        @for (device of devices.items(); track device.id) {
          <app-device-card [device]="device" />
        }
      </ui-grid>
    } @else if (devices.loaded()) {
      <ui-empty-state
        icon="devices"
        [heading]="'devices.empty.heading' | transloco"
        [description]="'devices.empty.description' | transloco"
      />
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DevicesOverview {
  protected readonly devices = injectDeviceList();
}
