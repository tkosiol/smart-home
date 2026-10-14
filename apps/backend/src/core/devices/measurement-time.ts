const FUTURE_TOLERANCE_MS = 2 * 60_000;
const MAX_AGE_MS = 7 * 24 * 60 * 60_000;

/** The time a reading was taken: Z2M's last_seen when plausible, else the receive time (flagged). */
export function measurementTime(
  lastSeen: unknown,
  receivedAt: Date,
): { time: Date; replaced: boolean } {
  // Only ISO 8601 with an explicit offset or Z; anything else (no offset, epoch numbers) is not trusted.
  if (typeof lastSeen === 'string' && /(Z|[+-]\d{2}:\d{2})$/.test(lastSeen)) {
    const time = new Date(lastSeen);
    const ms = time.getTime();
    const now = receivedAt.getTime();
    if (!Number.isNaN(ms) && ms <= now + FUTURE_TOLERANCE_MS && ms >= now - MAX_AGE_MS) {
      return { time, replaced: false };
    }
  }
  return { time: receivedAt, replaced: true };
}
