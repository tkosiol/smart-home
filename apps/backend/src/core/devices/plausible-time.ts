const FUTURE_TOLERANCE_MS = 2 * 60_000;
const MAX_AGE_MS = 7 * 24 * 60 * 60_000;

/**
 * The time a reading was taken: what the hardware says when it is plausible (at most two minutes
 * ahead, at most seven days old), else the receive time, flagged as replaced.
 */
export function plausibleTime(
  measuredAt: Date | undefined,
  receivedAt: Date,
): { time: Date; replaced: boolean } {
  const ms = measuredAt?.getTime() ?? Number.NaN;
  const now = receivedAt.getTime();
  if (
    measuredAt !== undefined &&
    !Number.isNaN(ms) &&
    ms <= now + FUTURE_TOLERANCE_MS &&
    ms >= now - MAX_AGE_MS
  ) {
    return { time: measuredAt, replaced: false };
  }
  return { time: receivedAt, replaced: true };
}
