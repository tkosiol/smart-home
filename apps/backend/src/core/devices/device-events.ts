import { EventEmitter } from 'node:events';

export const DEVICE_THRESHOLDS_CHANGED = 'device.thresholds-changed';

export const DEVICE_STATE_CHANGED = 'device.state-changed';

export const DEVICE_CHANGED = 'device.changed';

export const HARDWARE_CHANGED = 'hardware.changed';

export interface DeviceStateChanged {
  householdId: string;
  deviceId: string;
}

/** A device's data (state, availability, name, icon, thresholds) changed or it was created. */
export interface DeviceChanged {
  householdId: string;
  deviceId: string;
}

/** Hardware was added, changed, removed or got assigned to a device. */
export interface HardwareChanged {
  hardwareId: string;
}

export interface DeviceThresholdsChanged {
  householdId: string;
  deviceId: string;
}

/** The module's own event bus; other modules listen (`on(DEVICE_THRESHOLDS_CHANGED)`). */
export class DeviceEvents extends EventEmitter {}
