/** What the ingest hands over for a message of a piece of hardware (see `DeviceIngestConsumer`). */
export interface DeviceMessageHandler {
  /**
   * `payload` is the parsed JSON object of the message; the hardware belongs to the gateway.
   * `retained` is the MQTT retain flag: a replay the broker sent on subscribing, not a fresh report.
   */
  handle(
    gatewayId: string,
    hardwareId: string,
    payload: Record<string, unknown>,
    receivedAt: Date,
    retained: boolean,
  ): Promise<void>;
}

export const DEVICE_MESSAGE_HANDLER = Symbol('DEVICE_MESSAGE_HANDLER');
