import { UseGuards } from '@nestjs/common';
import { PlatformAdminGuard } from './platform-admin.guard.js';

/** Restricts a route to platform admins (403 `auth.forbidden` for everyone else). */
export const RequirePlatformAdmin = () => UseGuards(PlatformAdminGuard);
