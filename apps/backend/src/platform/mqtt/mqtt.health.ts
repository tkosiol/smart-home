import { Inject, Injectable } from '@nestjs/common';
import type { DependencyStatus } from '@smart/contracts';
import { MqttConnection } from './mqtt.connection.js';
import { MQTT_CONNECTION } from './mqtt.token.js';

@Injectable()
export class MqttHealth {
  constructor(@Inject(MQTT_CONNECTION) private readonly connection: MqttConnection) {}

  check(): DependencyStatus {
    return this.connection.isConnected() ? 'up' : 'down';
  }
}
