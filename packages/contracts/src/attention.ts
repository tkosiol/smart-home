import * as z from 'zod/mini';

export const ATTENTION_SEVERITIES = ['critical', 'warning', 'info'] as const;
export const ATTENTION_KINDS = [
  'gateway_offline',
  'device_silent',
  'soil_dry',
  'soil_wet',
  'battery_low',
  'contact_open',
  'hardware_new',
  'cert_expiring',
] as const;
export type AttentionSeverity = (typeof ATTENTION_SEVERITIES)[number];
export type AttentionKind = (typeof ATTENTION_KINDS)[number];

/** One thing the household should look at; `params` carries the values for the message. */
export const attentionItemSchema = z.object({
  id: z.string(),
  kind: z.enum(ATTENTION_KINDS),
  severity: z.enum(ATTENTION_SEVERITIES),
  /** ISO 8601 UTC. */
  since: z.iso.datetime(),
  deviceId: z.optional(z.string()),
  gatewayId: z.optional(z.string()),
  roomId: z.optional(z.string()),
  name: z.string(),
  value: z.optional(z.number()),
  unit: z.optional(z.string()),
  params: z.record(z.string(), z.unknown()),
});
export type AttentionItem = z.infer<typeof attentionItemSchema>;

export const attentionListSchema = z.object({ items: z.array(attentionItemSchema) });
export type AttentionList = z.infer<typeof attentionListSchema>;

export const SEVERITY_OF: Record<AttentionKind, AttentionSeverity> = {
  gateway_offline: 'critical',
  device_silent: 'critical',
  soil_dry: 'warning',
  soil_wet: 'warning',
  battery_low: 'warning',
  contact_open: 'info',
  hardware_new: 'info',
  cert_expiring: 'info',
};
