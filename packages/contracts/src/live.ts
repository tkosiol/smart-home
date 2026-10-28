import * as z from 'zod/mini';
import { attentionListSchema } from './attention.js';
import { deviceSchema, hardwareSchema } from './devices.js';
import { gatewaySchema } from './gateways.js';

export const LIVE_EVENT_TYPES = [
  'device.state',
  'gateway.status',
  'hardware.updated',
  'hardware.removed',
  'attention.changed',
] as const;
export type LiveEventType = (typeof LIVE_EVENT_TYPES)[number];

/** One event on the live stream; clients refetch on reconnect, so events carry the full object. */
export const liveEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('device.state'), data: deviceSchema }),
  z.object({ type: z.literal('gateway.status'), data: gatewaySchema }),
  z.object({ type: z.literal('hardware.updated'), data: hardwareSchema }),
  z.object({ type: z.literal('hardware.removed'), data: z.object({ id: z.string() }) }),
  z.object({ type: z.literal('attention.changed'), data: attentionListSchema }),
]);
export type LiveEvent = z.infer<typeof liveEventSchema>;
export type LiveEventData<T extends LiveEventType> = Extract<LiveEvent, { type: T }>['data'];
