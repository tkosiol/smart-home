export interface LiveOptions {
  /** How often every stream gets a ping and its session and membership are checked. */
  heartbeatMs: number;
  /** At most one event per object in this time. */
  throttleMs: number;
}

export const LIVE_OPTIONS = Symbol('LIVE_OPTIONS');

export const DEFAULT_LIVE_OPTIONS: LiveOptions = { heartbeatMs: 25_000, throttleMs: 1000 };
