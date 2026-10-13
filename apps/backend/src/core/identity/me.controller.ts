import { Body, Controller, Get, HttpStatus, Put } from '@nestjs/common';
import { preferencesUpdateSchema, type Me } from '@smart/contracts';
import { ApiError } from '../../platform/http/index.js';
import type { AuthenticatedUser } from './authenticated-user.js';
import { CurrentUser } from './current-user.decorator.js';
import { toMe } from './me.js';
import { UsersRepository } from './users.repository.js';

@Controller('v1/me')
export class MeController {
  constructor(private readonly users: UsersRepository) {}

  @Get()
  async me(@CurrentUser() current: AuthenticatedUser): Promise<Me> {
    const user = await this.users.findById(current.id);
    if (!user) throw new ApiError(HttpStatus.UNAUTHORIZED, 'auth.required');
    return toMe(user);
  }

  @Put('preferences')
  async updatePreferences(
    @CurrentUser() current: AuthenticatedUser,
    @Body() body: unknown,
  ): Promise<Me> {
    const update = preferencesUpdateSchema.parse(body);
    const user = await this.users.updatePreferences(current.id, update);
    if (!user) throw new ApiError(HttpStatus.UNAUTHORIZED, 'auth.required');
    return toMe(user);
  }
}
