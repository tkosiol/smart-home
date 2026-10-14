import { Inject, Injectable } from '@nestjs/common';
import { normalizeEmail, type Language, type PreferencesUpdate } from '@smart/contracts';
import { eq, sql } from 'drizzle-orm';
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

  async setPlatformAdmin(id: string): Promise<User | undefined> {
    const [row] = await this.connection.db
      .update(users)
      .set({ isPlatformAdmin: true, updatedAt: sql`now()` })
      .where(eq(users.id, id))
      .returning();
    return row;
  }

  /** Replaces what is given (`appearance` as a whole); fields left out stay as they are. */
  async updatePreferences(id: string, update: PreferencesUpdate): Promise<User | undefined> {
    const [row] = await this.connection.db
      .update(users)
      .set({ ...update, updatedAt: sql`now()` })
      .where(eq(users.id, id))
      .returning();
    return row;
  }

  /** Remembers the household the user selected last; the caller has checked the membership. */
  async setLastHousehold(id: string, householdId: string): Promise<User | undefined> {
    const [row] = await this.connection.db
      .update(users)
      .set({ lastHouseholdId: householdId, updatedAt: sql`now()` })
      .where(eq(users.id, id))
      .returning();
    return row;
  }
}
