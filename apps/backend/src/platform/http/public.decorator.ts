import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'smart:public';

/**
 * Marks a route (or controller) as reachable without a session. It lives in platform/http so that
 * platform controllers (health) can use it; the session guard in core/identity reads the metadata.
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);
