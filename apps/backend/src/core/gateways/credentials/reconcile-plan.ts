import { generationTag } from './password.js';

/** A user of the dynamic security plugin, as `listClients` with `verbose` lists it. */
export interface BrokerClient {
  username: string;
  textdescription?: string;
}

/** A gateway that should have a user: `credentials`, not revoked. */
export interface WantedClient {
  id: string;
  generation: number;
}

export type ClientStep =
  | { kind: 'create'; id: string; generation: number }
  | { kind: 'rekey'; id: string; generation: number }
  | { kind: 'delete'; username: string };

const keyOf = (step: ClientStep): string => (step.kind === 'delete' ? step.username : step.id);

/** Only differences: an unchanged client gets no step (a password reset would disconnect it). */
export function planReconcile(
  wanted: readonly WantedClient[],
  actual: readonly BrokerClient[],
): ClientStep[] {
  const present = new Map(actual.map((client) => [client.username, client]));
  const wantedIds = new Set(wanted.map((client) => client.id));
  const steps: ClientStep[] = [];
  for (const { id, generation } of wanted) {
    const found = present.get(id);
    if (found === undefined) steps.push({ kind: 'create', id, generation });
    else if (found.textdescription !== generationTag(generation)) {
      steps.push({ kind: 'rekey', id, generation });
    }
  }
  for (const { username } of present.values()) {
    if (!wantedIds.has(username)) steps.push({ kind: 'delete', username });
  }
  // By ID, independent of locale and input order.
  return steps.sort((a, b) => {
    const [left, right] = [keyOf(a), keyOf(b)];
    if (left === right) return 0;
    return left < right ? -1 : 1;
  });
}
