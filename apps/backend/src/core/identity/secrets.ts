import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

export const newToken = (): string => randomBytes(32).toString('base64url');
export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
export const newLoginCode = (): string => String(randomInt(0, 1_000_000)).padStart(6, '0');

/** Constant-time comparison; compares byte lengths (not string lengths) so it never throws. */
export function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
