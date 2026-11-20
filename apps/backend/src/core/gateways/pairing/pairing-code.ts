import { createHash, randomInt } from 'node:crypto';

/** Crockford base32: no I, L, O, U, so nothing is mistaken for 1, 0 or V. */
export const PAIRING_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 8;
const GATEWAY_ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
const GATEWAY_ID_LENGTH = 8;

const draw = (alphabet: string, length: number): string =>
  Array.from({ length }, () => alphabet.charAt(randomInt(alphabet.length))).join('');

/** 40 random bits, shown as `XXXX-XXXX`. */
export function newPairingCode(): string {
  const code = draw(PAIRING_ALPHABET, CODE_LENGTH);
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** Upper case, without blanks and dashes, O→0, I/L→1; undefined unless 8 alphabet characters remain. */
export function normalizePairingCode(input: string): string | undefined {
  const normalized = input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  if (normalized.length !== CODE_LENGTH) return undefined;
  return [...normalized].every((char) => PAIRING_ALPHABET.includes(char)) ? normalized : undefined;
}

/** What the database keeps of a code. */
export const hashPairingCode = (normalized: string): string =>
  createHash('sha256').update(normalized).digest('hex');

/** A new gateway's ID (`gw-` and 8 characters [a-z0-9]), which is also its broker user name. */
export function newGatewayId(): string {
  return `gw-${draw(GATEWAY_ID_ALPHABET, GATEWAY_ID_LENGTH)}`;
}
