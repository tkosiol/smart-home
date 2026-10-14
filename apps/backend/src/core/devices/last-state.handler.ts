import { Injectable } from '@nestjs/common';
import type { DeviceMessageHandler } from './device-message-handler.js';
import { HardwareRepository } from './hardware.repository.js';

/**
 * Placeholder until readings are processed: only keeps the hardware's last state and time (the
 * retain flag is ignored).
 */
@Injectable()
export class LastStateHandler implements DeviceMessageHandler {
  constructor(private readonly hardware: HardwareRepository) {}

  async handle(
    _gatewayId: string,
    hardwareId: string,
    payload: Record<string, unknown>,
    receivedAt: Date,
  ): Promise<void> {
    await this.hardware.recordState(hardwareId, payload, receivedAt);
  }
}
