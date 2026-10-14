import { MAILPIT_URL } from './env';

interface MessageSummary {
  ID: string;
  To: { Address: string }[];
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(new URL(path, MAILPIT_URL));
  if (!response.ok) throw new Error(`Mailpit ${path} answered ${response.status}`);
  return (await response.json()) as T;
}

/** IDs of all messages to `address` that Mailpit holds (newest first). */
export async function mailsTo(address: string): Promise<string[]> {
  const { messages } = await getJson<{ messages: MessageSummary[] }>('/api/v1/messages?limit=500');
  return messages
    .filter((message) => message.To.some((to) => to.Address.toLowerCase() === address))
    .map((message) => message.ID);
}

/**
 * The plain-text body of the first mail to `address` that is not in `seen` (take `mailsTo` before
 * causing the mail). Polls, because the mail arrives a moment after the request is answered.
 */
export async function textOfNewMail(
  address: string,
  seen: readonly string[],
  timeoutMs = 15_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const fresh = (await mailsTo(address)).find((id) => !seen.includes(id));
    if (fresh) return (await getJson<{ Text: string }>(`/api/v1/message/${fresh}`)).Text;
    if (Date.now() > deadline)
      throw new Error(`no mail to ${address} arrived within ${timeoutMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/** The six-digit code of the first new sign-in mail to `address` (see `textOfNewMail`). */
export async function codeFromNewMail(
  address: string,
  seen: readonly string[],
  timeoutMs = 15_000,
): Promise<string> {
  const code = /\b(\d{6})\b/.exec(await textOfNewMail(address, seen, timeoutMs))?.[1];
  if (!code) throw new Error('the sign-in mail has no six-digit code');
  return code;
}
