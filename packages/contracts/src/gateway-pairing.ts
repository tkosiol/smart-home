import * as z from 'zod/mini';
import { gatewayIdSchema } from './gateways.js';
import { displayNameSchema } from './households.js';

/** A pairing code as shown: two groups of four characters of the Crockford base32 alphabet. */
export const PAIRING_CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

/** Creates a code: for a new gateway of the household, or (with an ID) to pair an existing one anew. */
export const gatewayPairingCreateSchema = z.object({
  gatewayId: z.optional(gatewayIdSchema),
});
export type GatewayPairingCreate = z.infer<typeof gatewayPairingCreateSchema>;

export const gatewayPairingSchema = z.object({
  /** `XXXX-XXXX`, valid for 15 minutes. */
  code: z.string(),
  /** ISO 8601 UTC (`…Z`). */
  expiresAt: z.string(),
  /** The address of the app, which Home Assistant needs to pair. */
  appUrl: z.string(),
});
export type GatewayPairing = z.infer<typeof gatewayPairingSchema>;

/** What Home Assistant sends: the server normalizes the code, so any spelling is accepted. */
export const gatewayPairingRedeemSchema = z.object({
  code: z.string().check(z.minLength(1), z.maxLength(32)),
  name: z.optional(displayNameSchema),
  expectedGatewayId: z.optional(gatewayIdSchema),
});
export type GatewayPairingRedeem = z.infer<typeof gatewayPairingRedeemSchema>;

export const gatewayPairingRedeemedSchema = z.object({
  gatewayId: gatewayIdSchema,
  mqttUrl: z.string(),
  username: z.string(),
  password: z.string(),
  clientId: z.string(),
});
export type GatewayPairingRedeemed = z.infer<typeof gatewayPairingRedeemedSchema>;
