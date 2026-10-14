import type { GatewayWarning } from '@smart/contracts';

const EXPIRY_WARNING_MS = 30 * 86_400_000;

/** The CRL, which is the same for all gateways, is due for renewal within 30 days (or overdue). */
export function crlExpiring(crlNextUpdate: Date | undefined, now: Date): boolean {
  return crlNextUpdate !== undefined && crlNextUpdate.getTime() - now.getTime() < EXPIRY_WARNING_MS;
}

/**
 * Warnings of a gateway in the list: its certificate expires within 30 days (or has expired) and
 * the CRL is due for renewal.
 */
export function gatewayWarnings(
  certExpiresAt: Date,
  crlNextUpdate: Date | undefined,
  now: Date,
): GatewayWarning[] {
  const warnings: GatewayWarning[] = [];
  const certLeft = certExpiresAt.getTime() - now.getTime();
  if (certLeft <= 0) warnings.push('certExpired');
  else if (certLeft < EXPIRY_WARNING_MS) warnings.push('certExpiring');
  if (crlExpiring(crlNextUpdate, now)) warnings.push('crlExpiring');
  return warnings;
}
