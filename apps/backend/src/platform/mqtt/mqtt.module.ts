import {
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ENV, type Env } from '../config/index.js';
import { MqttConnection } from './mqtt.connection.js';
import { MqttHealth } from './mqtt.health.js';
import { MQTT_CONNECTION } from './mqtt.token.js';

@Injectable()
class MqttLifecycle implements OnApplicationShutdown {
  constructor(@Inject(MQTT_CONNECTION) private readonly connection: MqttConnection) {}

  async onApplicationShutdown(): Promise<void> {
    await this.connection.close();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: MQTT_CONNECTION,
      inject: [ENV],
      useFactory: (env: Env): MqttConnection => {
        const logger = new Logger('Mqtt');
        return new MqttConnection({
          url: env.MQTT_URL,
          username: env.MQTT_USERNAME,
          password: env.MQTT_PASSWORD,
          clientId: env.MQTT_CLIENT_ID,
          onError: (error) => logger.warn(`broker connection error: ${error.message}`),
        });
      },
    },
    MqttHealth,
    MqttLifecycle,
  ],
  exports: [MQTT_CONNECTION, MqttHealth],
})
export class MqttModule {}
