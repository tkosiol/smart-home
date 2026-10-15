import { normalizeEmail } from '@smart/contracts';
import { z } from 'zod';

/** Empty values (e.g. `SMTP_URL=` from a compose file) count as unset. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    MQTT_URL: z.url({ protocol: /^mqtts?$/ }),
    MQTT_USERNAME: z.string().min(1),
    MQTT_PASSWORD: z.string().min(1),
    /**
     * The MQTT client ID: fixed, so that the broker keeps the session (subscriptions, queued
     * messages) while the app restarts. One per running instance; two with the same ID take the
     * connection from each other. Default: `smart-api-<STACK_NAME>`, or `smart-api-local`.
     */
    MQTT_CLIENT_ID: optional(z.string().regex(/^[A-Za-z0-9._-]{1,128}$/)),
    /** Names the stack (set by the compose file, which derives `MQTT_CLIENT_ID` from it). */
    STACK_NAME: optional(z.string().regex(/^[A-Za-z0-9._-]{1,100}$/)),
    /** Public origin of the web app; it must equal what browsers send as `Origin` (no path). */
    APP_ORIGIN: z
      .url()
      .refine(
        (value) => URL.canParse(value) && new URL(value).origin === value,
        'expected an origin without a path',
      ),
    /**
     * Reverse proxies in front of the API (web nginx = 1, plus Nginx Proxy Manager on the VPS = 2).
     * Client IPs (rate limits) are read that many entries from the right of X-Forwarded-For.
     */
    TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).default(1),
    /** Without it the e-mail sign-in is switched off. Carries credentials: never log it. */
    SMTP_URL: optional(z.url({ protocol: /^smtps?$/ })),
    MAIL_FROM: optional(z.string().min(1)),
    /** Staging safety net: only these (normalized) recipients receive mail. Unset = everyone. */
    MAIL_ALLOWLIST: optional(
      z.string().transform((value) => {
        const addresses = value
          .split(',')
          .map(normalizeEmail)
          .filter((address) => address !== '');
        return addresses.length > 0 ? addresses : undefined;
      }),
    ),
    /** The CA certificate (PEM, public) gateway certificates must be signed by; unset = no registration. */
    GATEWAY_CA_FILE: optional(z.string().min(1)),
    /** A file with the ISO 8601 time the broker's CRL needs renewing (written by `pki.sh`). */
    GATEWAY_CRL_NEXT_UPDATE_FILE: optional(z.string().min(1)),
  })
  .refine((env) => env.SMTP_URL === undefined || env.MAIL_FROM !== undefined, {
    path: ['MAIL_FROM'],
    message: 'required when SMTP_URL is set',
  })
  .transform((env) => ({
    ...env,
    MQTT_CLIENT_ID: env.MQTT_CLIENT_ID ?? `smart-api-${env.STACK_NAME ?? 'local'}`,
  }));
export type Env = z.infer<typeof envSchema>;

/** Validates the process environment once at startup; the error lists keys, never values. */
export function loadEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.code}`);
    throw new Error(`Invalid environment configuration:\n- ${problems.join('\n- ')}`);
  }
  return result.data;
}
