import { describe, expect, it } from 'vitest';
import { loginCode } from './login-code.js';

describe('loginCode', () => {
  it('writes the German mail with the code, validity and ignore hint', () => {
    const mail = loginCode('de', '123456');
    expect(mail.subject).toContain('123456');
    expect(mail.text).toContain('123456');
    expect(mail.text).toContain('10 Minuten');
    expect(mail.text).toContain('Nicht angefordert? Ignorieren.');
    expect(mail.html).toContain('123456');
    expect(mail.html).toContain('10 Minuten');
    expect(mail.html).toContain('<html lang="de">');
  });

  it('writes the English mail with the code, validity and ignore hint', () => {
    const mail = loginCode('en', '654321');
    expect(mail.subject).toContain('654321');
    expect(mail.text).toContain('654321');
    expect(mail.text).toContain('10 minutes');
    expect(mail.text).toContain('Not requested? Ignore this mail.');
    expect(mail.html).toContain('654321');
    expect(mail.html).toContain('<html lang="en">');
  });

  it('shows the code large in the HTML part', () => {
    expect(loginCode('en', '111222').html).toMatch(/font-size:\s*32px[^>]*>\s*111222\s*</);
  });
});
