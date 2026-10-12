const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/;

/** `#rrggbb` (lowercase) from user input like `6F9D2F` or `#abc`; null when it is not a hex color. */
export function normalizeHexColor(raw: string): string | null {
  const text = raw.trim().toLowerCase();
  const withHash = text.startsWith('#') ? text : `#${text}`;
  if (!HEX.test(withHash)) return null;
  if (withHash.length === 7) return withHash;
  return `#${[...withHash.slice(1)].map((digit) => digit + digit).join('')}`;
}
