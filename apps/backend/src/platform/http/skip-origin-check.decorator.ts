import { SetMetadata } from '@nestjs/common';

export const SKIP_ORIGIN_CHECK_KEY = 'smart:skip-origin-check';

/**
 * Exempts a route (or controller) from the Origin check. Only for routes that read neither cookies
 * nor a session and are authorised by a secret in the body alone (pairing a gateway): without
 * ambient credentials there is nothing a forged cross-site request could use.
 */
export const SkipOriginCheck = (): MethodDecorator & ClassDecorator =>
  SetMetadata(SKIP_ORIGIN_CHECK_KEY, true);
