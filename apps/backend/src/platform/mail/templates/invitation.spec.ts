import { describe, expect, it } from 'vitest';
import { invitation } from './invitation.js';

const details = {
  householdName: 'Zuhause',
  inviterName: 'Anna',
  link: 'https://smart.example.org/einladung/abc_DEF-123',
};

describe('invitation', () => {
  it('writes the German mail with household, inviter, link and validity', () => {
    const mail = invitation('de', details);
    expect(mail.subject).toBe('Anna lädt dich zu „Zuhause“ ein');
    expect(mail.text).toContain('Anna');
    expect(mail.text).toContain('Zuhause');
    expect(mail.text).toContain(details.link);
    expect(mail.text).toContain('7 Tage');
    expect(mail.html).toContain(`href="${details.link}"`);
    expect(mail.html).toContain('<html lang="de">');
  });

  it('writes the English mail with household, inviter, link and validity', () => {
    const mail = invitation('en', details);
    expect(mail.subject).toBe('Anna invites you to “Zuhause”');
    expect(mail.text).toContain(details.link);
    expect(mail.text).toContain('7 days');
    expect(mail.html).toContain('<html lang="en">');
  });

  it('escapes names in the HTML part and keeps header lines single', () => {
    const mail = invitation('en', {
      ...details,
      householdName: '<script>alert(1)</script>',
      inviterName: 'Eve\r\nBcc: x@example.org',
    });
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;');
    expect(mail.subject).not.toMatch(/[\r\n]/);
  });
});
