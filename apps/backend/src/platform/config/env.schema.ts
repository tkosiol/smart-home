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
  })
  .refine((env) => env.SMTP_URL === undefined || env.MAIL_FROM !== undefined, {
    path: ['MAIL_FROM'],
    message: 'required when SMTP_URL is set',
  });
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
