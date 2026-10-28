import type { LiveEventType } from '@smart/contracts';

export const SSE_CONNECTED = ': connected\n\n';
export const SSE_PING = ': ping\n\n';

/** One server-sent event; JSON escapes line breaks, so the data always stays on one line. */
export function sseEvent(type: LiveEventType, data: unknown): string {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}
