import { HttpStatus, Logger } from '@nestjs/common';
import type { MailMessage, MailSender } from '../../platform/mail/index.js';
import { EmailLoginService } from './email-login.service.js';
import type { EmailLoginRepository } from './email-login.repository.js';
import type { User } from './identity.schema.js';
import type { SessionService } from './session.service.js';
import type { UsersRepository } from './users.repository.js';

const NOW = new Date('2026-03-01T10:00:00Z');
const user = { id: 'u1', email: 'anna@example.org', locale: 'de' } as User;

function setup(options: { known?: boolean; send?: MailSender['send']; enabled?: boolean } = {}) {
  const sent: MailMessage[] = [];
  const mail: MailSender = {
    enabled: options.enabled ?? true,
    send: options.send ?? ((message) => (sent.push(message), Promise.resolve())),
  };
  const replaceOpen = vi.fn().mockResolvedValue({ issued: true });
  const findByEmail = vi.fn().mockResolvedValue(options.known === false ? undefined : user);
  const service = new EmailLoginService(
    { findByEmail } as unknown as UsersRepository,
    { replaceOpen } as unknown as EmailLoginRepository,
    {} as SessionService,
    mail,
    () => NOW,
  );
  return { service, sent, replaceOpen, findByEmail };
}

describe('EmailLoginService.request', () => {
  it('answers 503 when mail is disabled, before looking anything up', async () => {
    const { service, findByEmail } = setup({ enabled: false });
    await expect(service.request('anna@example.org', 'n')).rejects.toMatchObject({
      code: 'auth.mailDisabled',
      status: HttpStatus.SERVICE_UNAVAILABLE,
    });
    expect(findByEmail).not.toHaveBeenCalled();
  });

  it('stores only hashes and mails the code for a known address', async () => {
    const { service, sent, replaceOpen } = setup();
    await service.request('anna@example.org', 'the-nonce');
    expect(sent).toHaveLength(1);
    const code = /\b(\d{6})\b/.exec(sent[0]?.text ?? '')?.[1] ?? '';
    const [email, stored, limit] = replaceOpen.mock.calls[0] as [
      string,
      Record<string, unknown>,
      object,
    ];
    expect(email).toBe('anna@example.org');
    expect(JSON.stringify(stored)).not.toContain(code);
    expect(JSON.stringify(stored)).not.toContain('the-nonce');
    expect(stored.expiresAt).toEqual(new Date(NOW.getTime() + 10 * 60_000));
    expect(limit).toEqual({ now: NOW, max: 3, windowMs: 15 * 60_000 });
  });

  it('does not write or mail for an unknown address', async () => {
    const { service, sent, replaceOpen } = setup({ known: false });
    await expect(service.request('nobody@example.org', 'n')).resolves.toBeUndefined();
    expect(sent).toHaveLength(0);
    expect(replaceOpen).not.toHaveBeenCalled();
  });

  it('turns an exhausted per-address limit into 429 with retryAfterSeconds', async () => {
    const { service, replaceOpen } = setup();
    replaceOpen.mockResolvedValue({ issued: false, retryAt: new Date(NOW.getTime() + 90_500) });
    await expect(service.request('anna@example.org', 'n')).rejects.toMatchObject({
      code: 'auth.rateLimited',
      status: HttpStatus.TOO_MANY_REQUESTS,
      params: { retryAfterSeconds: 91 },
    });
  });

  it.each([
    ['rejects', () => Promise.reject(new Error('boom: anna@example.org'))],
    [
      'throws synchronously',
      () => {
        throw new Error('boom: anna@example.org');
      },
    ],
  ])(
    'does not wait for or fail on a mail that %s, and logs only the masked address',
    async (_, send) => {
      const log = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      try {
        const { service } = setup({ send });
        await expect(service.request('anna@example.org', 'n')).resolves.toBeUndefined();
        await vi.waitFor(() => expect(log).toHaveBeenCalledTimes(1));
        expect(String(log.mock.calls[0]?.[0])).toContain('a***@example.org');
        expect(JSON.stringify(log.mock.calls)).not.toContain('anna@');
      } finally {
        log.mockRestore();
      }
    },
  );

  it('returns before a slow mail is delivered', async () => {
    let finish: () => void = () => undefined;
    const delivered = new Promise<void>((resolve) => (finish = resolve));
    const { service } = setup({ send: () => delivered });
    await expect(service.request('anna@example.org', 'n')).resolves.toBeUndefined();
    finish();
  });
});
