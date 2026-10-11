import { connect, type MqttClient } from 'mqtt';

export interface MqttSettings {
  url: string;
  username: string;
  password: string;
  clientId: string;
  onError?: (error: Error) => void;
}

/** Long-lived broker connection with automatic reconnect; errors never crash the process. */
export class MqttConnection {
  private readonly client: MqttClient;

  constructor(settings: MqttSettings) {
    this.client = connect(settings.url, {
      username: settings.username,
      password: settings.password,
      clientId: settings.clientId,
      clean: true,
      connectTimeout: 5000,
      reconnectPeriod: 2000,
    });
    this.client.on('error', (error) => settings.onError?.(error));
  }

  isConnected(): boolean {
    return this.client.connected;
  }

  waitUntilConnected(timeoutMs: number): Promise<boolean> {
    if (this.client.connected) return Promise.resolve(true);
    return new Promise((resolve) => {
      const onConnect = (): void => {
        clearTimeout(timer);
        resolve(true);
      };
      const timer = setTimeout(() => {
        this.client.off('connect', onConnect);
        resolve(false);
      }, timeoutMs);
      this.client.once('connect', onConnect);
    });
  }

  async close(): Promise<void> {
    await this.client.endAsync(true);
  }
}
