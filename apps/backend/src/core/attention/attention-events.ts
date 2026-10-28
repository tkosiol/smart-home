import { EventEmitter } from 'node:events';

export const ATTENTION_CHANGED = 'attention.changed';

export interface AttentionChanged {
  householdId: string;
}

/** The module's own event bus: the household's attention items differ from what they were. */
export class AttentionEvents extends EventEmitter {}
