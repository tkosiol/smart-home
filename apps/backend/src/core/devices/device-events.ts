import { EventEmitter } from 'node:events';

export const DEVICE_THRESHOLDS_CHANGED = 'device.thresholds-changed';

export interface DeviceThresholdsChanged {
  householdId: string;
  deviceId: string;
}

/** The module's own event bus; later stages listen (`on(DEVICE_THRESHOLDS_CHANGED)`). */
export class DeviceEvents extends EventEmitter {}
