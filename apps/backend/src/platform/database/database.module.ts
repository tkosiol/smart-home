import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ENV, type Env } from '../config/index.js';
import { createDatabaseConnection, type DatabaseConnection } from './database.client.js';
import { DatabaseHealth } from './database.health.js';
import { DATABASE } from './database.token.js';

@Injectable()
class DatabaseLifecycle implements OnApplicationShutdown {
  constructor(@Inject(DATABASE) private readonly connection: DatabaseConnection) {}

  async onApplicationShutdown(): Promise<void> {
    await this.connection.sql.end({ timeout: 5 });
  }
}

@Global()
@Module({
  providers: [
    {
      provide: DATABASE,
      inject: [ENV],
      useFactory: (env: Env): DatabaseConnection => createDatabaseConnection(env.DATABASE_URL),
    },
    DatabaseHealth,
    DatabaseLifecycle,
  ],
  exports: [DATABASE, DatabaseHealth],
})
export class DatabaseModule {}
