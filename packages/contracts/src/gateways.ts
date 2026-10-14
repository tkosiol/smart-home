import * as z from 'zod/mini';
import { displayNameSchema } from './households.js';

/** The ID of a gateway: also its MQTT client ID and the common name of its certificate. */
export const GATEWAY_ID_PATTERN = /^gw-[a-z0-9]{8}$/;
export const gatewayIdSchema = z.string().check(z.regex(GATEWAY_ID_PATTERN));

export const GATEWAY_STATUSES = ['online', 'offline', 'unknown'] as const;
export type GatewayStatus = (typeof GATEWAY_STATUSES)[number];
export const gatewayStatusSchema = z.enum(GATEWAY_STATUSES);

export const GATEWAY_WARNINGS = ['certExpiring', 'certExpired', 'crlExpiring'] as const;
export type GatewayWarning = (typeof GATEWAY_WARNINGS)[number];
export const gatewayWarningSchema = z.enum(GATEWAY_WARNINGS);

export const gatewaySchema = z.object({
  id: gatewayIdSchema,
  name: z.string(),
  kind: z.literal('z2m'),
  topicPrefix: z.string(),
  bridgeStatus: gatewayStatusSchema,
  z2mStatus: gatewayStatusSchema,
  /** ISO 8601 UTC (`…Z`). */
  statusChangedAt: z.nullable(z.string()),
  /** ISO 8601 UTC (`…Z`). */
  lastMessageAt: z.nullable(z.string()),
  /** ISO 8601 UTC (`…Z`). */
  certExpiresAt: z.string(),
  /** ISO 8601 UTC (`…Z`). */
  revokedAt: z.nullable(z.string()),
  warnings: z.array(gatewayWarningSchema),
});
export type Gateway = z.infer<typeof gatewaySchema>;

/** A gateway is registered by its signed certificate (PEM); the private key never leaves it. */
export const gatewayRegisterSchema = z.object({
  name: displayNameSchema,
  certificate: z.string().check(z.minLength(1), z.maxLength(20_000)),
});
export type GatewayRegister = z.infer<typeof gatewayRegisterSchema>;
