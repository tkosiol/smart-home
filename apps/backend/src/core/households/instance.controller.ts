import { Body, Controller, Get, Put } from '@nestjs/common';
import { instanceAppearanceUpdateSchema, type InstanceAppearance } from '@smart/contracts';
import { Public } from '../../platform/http/index.js';
import { type AuthenticatedUser, CurrentUser, RequirePlatformAdmin } from '../identity/index.js';
import { InstanceSettingsRepository } from './instance-settings.repository.js';

interface InstanceAppearanceResponse {
  appearance: InstanceAppearance | null;
}

@Controller('v1/instance/appearance')
export class InstanceController {
  constructor(private readonly settings: InstanceSettingsRepository) {}

  /** Public: the login page needs the look before anyone is signed in. */
  @Get()
  @Public()
  async get(): Promise<InstanceAppearanceResponse> {
    return { appearance: await this.settings.getAppearance() };
  }

  @Put()
  @RequirePlatformAdmin()
  async put(
    @CurrentUser() current: AuthenticatedUser,
    @Body() body: unknown,
  ): Promise<InstanceAppearanceResponse> {
    const { appearance } = instanceAppearanceUpdateSchema.parse(body);
    await this.settings.setAppearance(appearance, current.id);
    return { appearance: await this.settings.getAppearance() };
  }
}
