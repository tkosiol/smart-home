import { Inject, Injectable } from '@nestjs/common';
import { instanceAppearanceSchema, type InstanceAppearance } from '@smart/contracts';
import { eq, sql } from 'drizzle-orm';
import { DATABASE, type DatabaseConnection } from '../../platform/database/index.js';
import { instanceSettings } from './instance-settings.schema.js';

const SETTINGS_ID = 1;

@Injectable()
export class InstanceSettingsRepository {
  constructor(@Inject(DATABASE) private readonly connection: DatabaseConnection) {}

  /** The stored appearance; `null` when none is stored or the stored value no longer validates. */
  async getAppearance(): Promise<InstanceAppearance | null> {
    const [row] = await this.connection.db
      .select({ appearance: instanceSettings.appearance })
      .from(instanceSettings)
      .where(eq(instanceSettings.id, SETTINGS_ID));
    const parsed = instanceAppearanceSchema.safeParse(row?.appearance);
    return parsed.success ? parsed.data : null;
  }

  /** Replaces the appearance as a whole; `null` resets it. */
  async setAppearance(appearance: InstanceAppearance | null, userId: string): Promise<void> {
    const values = { appearance, updatedBy: userId };
    await this.connection.db
      .insert(instanceSettings)
      .values({ id: SETTINGS_ID, ...values })
      .onConflictDoUpdate({
        target: instanceSettings.id,
        set: { ...values, updatedAt: sql`now()` },
      });
  }
}
