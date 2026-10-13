import { Inject, Injectable } from '@nestjs/common';
import { normalizeEmail, type Language } from '@smart/contracts';
import { eq } from 'drizzle-orm';
import { DATABASE, type DatabaseConnection } from '../../platform/database/index.js';
import { users, type User } from './identity.schema.js';

export interface NewUser {
  email: string;
  displayName: string;
  locale?: Language;
  isPlatformAdmin?: boolean;
}

@Injectable()
export class UsersRepository {
  constructor(@Inject(DATABASE) private readonly connection: DatabaseConnection) {}

  async create(input: NewUser): Promise<User> {
    const [row] = await this.connection.db
      .insert(users)
      .values({ ...input, email: normalizeEmail(input.email) })
      .returning();
    if (!row) throw new Error('Inserting a user returned no row');
    return row;
  }

  async findByEmail(email: string): Promise<User | undefined> {
    const [row] = await this.connection.db
      .select()
      .from(users)
      .where(eq(users.email, normalizeEmail(email)));
    return row;
  }

  async findById(id: string): Promise<User | undefined> {
    const [row] = await this.connection.db.select().from(users).where(eq(users.id, id));
    return row;
  }
}
