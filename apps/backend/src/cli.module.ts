import { Module } from '@nestjs/common';
import { IdentityModule } from './core/identity/index.js';
import { ConfigModule } from './platform/config/index.js';
import { DatabaseModule } from './platform/database/index.js';

/**
 * The module graph of the administration CLI (`cli.ts`), which runs inside the running api
 * container. The commands only use the database (users, sessions), so there is deliberately no
 * MqttModule here: the api's MQTT client id belongs to one process at a time (a persistent
 * session at the broker), and a second process with that id takes the session over and kicks the
 * api off. No scheduler either, so that no cron job runs a second time beside the api's.
 * Do not add a module that needs the broker; a command that does must get its own
 * non-persistent connection (random client id, clean start).
 */
@Module({ imports: [ConfigModule, DatabaseModule, IdentityModule] })
export class CliModule {}
