/** JSON of a payload, or `undefined` if it is none. */
export const parseJson = (payload: Buffer): unknown => {
  try {
    return JSON.parse(payload.toString('utf8'));
  } catch {
    return undefined;
  }
};

export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
