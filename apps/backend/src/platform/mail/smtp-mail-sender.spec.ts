import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DisabledMailSender, type MailSender } from './mail-sender.js';
import { SmtpMailSender } from './smtp-mail-sender.js';

const message = {
  to: 'till@example.org',
  subject: 'Your code',
  text: 'Code 123456',
  html: '<p>Code 123456</p>',
};

afterEach(() => vi.restoreAllMocks());

describe('SmtpMailSender', () => {
  it('sends through the transport with the configured sender', async () => {
    const transport = { sendMail: vi.fn().mockResolvedValue({}) };
    const sender = new SmtpMailSender(transport, 'Smart Home <noreply@example.org>');

    await sender.send(message);

    expect(sender.enabled).toBe(true);
    expect(transport.sendMail).toHaveBeenCalledExactlyOnceWith({
      from: 'Smart Home <noreply@example.org>',
      ...message,
    });
  });

  it('sends to allowlisted recipients regardless of case and whitespace', async () => {
    const transport = { sendMail: vi.fn().mockResolvedValue({}) };
    const sender = new SmtpMailSender(transport, 'noreply@example.org', ['till@example.org']);

    await sender.send({ ...message, to: ' Till@Example.org ' });

    expect(transport.sendMail).toHaveBeenCalledOnce();
  });

  it('drops recipients outside the allowlist and logs them masked', async () => {
    const transport = { sendMail: vi.fn().mockResolvedValue({}) };
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const sender = new SmtpMailSender(transport, 'noreply@example.org', ['other@example.org']);

    await sender.send(message);

    expect(transport.sendMail).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
    const logged = String(warn.mock.calls[0]?.[0]);
    expect(logged).toContain('t***@example.org');
    expect(logged).not.toContain('till@example.org');
  });

  it('propagates transport failures without logging the message', async () => {
    const transport = { sendMail: vi.fn().mockRejectedValue(new Error('connection refused')) };
    const sender = new SmtpMailSender(transport, 'noreply@example.org');

    await expect(sender.send(message)).rejects.toThrow('connection refused');
  });
});

describe('DisabledMailSender', () => {
  it('reports itself as disabled and refuses to send', async () => {
    const sender: MailSender = new DisabledMailSender();
    expect(sender.enabled).toBe(false);
    await expect(sender.send(message)).rejects.toThrow(/disabled/i);
  });
});
