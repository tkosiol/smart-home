import type { Language } from '@smart/contracts';
import type { MailMessage } from '../mail-sender.js';

export type LoginCodeMail = Pick<MailMessage, 'subject' | 'text' | 'html'>;

const texts = {
  de: {
    subject: (code: string) => `${code} ist dein Anmeldecode`,
    intro: 'Dein Anmeldecode für Smart Home:',
    validity: 'Der Code ist 10 Minuten gültig.',
    ignore: 'Nicht angefordert? Ignorieren.',
  },
  en: {
    subject: (code: string) => `${code} is your sign-in code`,
    intro: 'Your Smart Home sign-in code:',
    validity: 'The code is valid for 10 minutes.',
    ignore: 'Not requested? Ignore this mail.',
  },
} as const satisfies Record<Language, unknown>;

/** The sign-in code mail; `code` is a short run of digits, never logged. */
export function loginCode(locale: Language, code: string): LoginCodeMail {
  const t = texts[locale];
  return {
    subject: t.subject(code),
    text: `${t.intro}\n\n${code}\n\n${t.validity}\n${t.ignore}\n`,
    html: [
      `<!doctype html><html lang="${locale}"><body style="font-family: sans-serif; color: #1c1b1f">`,
      `<p>${t.intro}</p>`,
      `<p style="font-size: 32px; font-weight: bold; letter-spacing: 0.2em; font-family: monospace">${code}</p>`,
      `<p>${t.validity}</p>`,
      `<p style="color: #605d62">${t.ignore}</p>`,
      '</body></html>',
    ].join(''),
  };
}
