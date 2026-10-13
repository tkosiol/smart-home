const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Postgres throws on a malformed uuid; check before using a client supplied id in a query. */
export const isUuid = (value: string): boolean => UUID.test(value);
