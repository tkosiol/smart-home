import { Inject, Injectable } from '@nestjs/common';
import type { DependencyStatus } from '@smart/contracts';
import type { DatabaseConnection } from './database.client.js';
import { DATABASE } from './database.token.js';

@Injectable()
export class DatabaseHealth {
  constructor(@Inject(DATABASE) private readonly connection: DatabaseConnection) {}

  async check(timeoutMs = 2000): Promise<DependencyStatus> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('database health check timed out')), timeoutMs);
    });
    try {
      await Promise.race([this.connection.sql`select 1`, timeout]);
      return 'up';
    } catch {
      return 'down';
    } finally {
      clearTimeout(timer);
    }
  }
}
