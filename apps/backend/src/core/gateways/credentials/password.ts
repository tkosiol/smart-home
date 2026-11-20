import { createHmac } from 'node:crypto';

/**
 * The broker password of a gateway paired from the app (spec 5.3): derived from the secret, never
 * stored, so the backend can recreate every user at the broker at any time. 43 URL-safe characters.
 */
export function deriveGatewayPassword(
  secret: string,
  gatewayId: string,
  generation: number,
): string {
  return createHmac('sha256', secret)
    .update(`smart-gateway-credential\0${gatewayId}\0${generation}`)
    .digest('base64url');
}

/** The only client ID the broker accepts for the gateway's user. */
export const gatewayClientId = (gatewayId: string): string => `${gatewayId}-ha`;

/** The broker user's `textdescription`: tells a stale key apart without reading the password. */
export const generationTag = (generation: number): string => `generation:${generation}`;
