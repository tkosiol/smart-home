import { SetMetadata } from '@nestjs/common';

export const SKIP_ORIGIN_CHECK_KEY = 'smart:skip-origin-check';

/**
 * Exempts a handler from the Origin check. Only for routes that read neither cookies nor a session
 * and are authorised by a secret in the body alone (pairing a gateway): without ambient
 * credentials there is nothing a forged cross-site request could use. The guard honours it only
 * together with `@Public()` (on the handler or its controller); a single handler only, never a
 * whole controller.
 */
export const SkipOriginCheck = (): MethodDecorator => SetMetadata(SKIP_ORIGIN_CHECK_KEY, true);
