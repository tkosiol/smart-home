import type { Language } from '@smart/contracts';
import type { MailMessage } from '../mail-sender.js';

export type InvitationMail = Pick<MailMessage, 'subject' | 'text' | 'html'>;

export interface InvitationDetails {
  householdName: string;
  inviterName: string;
  /** The personal link; never logged. */
  link: string;
}

const texts = {
  de: {
    subject: (inviter: string, household: string) => `${inviter} lädt dich zu „${household}“ ein`,
    intro: (inviter: string, household: string) =>
      `${inviter} hat dich zum Haushalt „${household}“ in Smart Home eingeladen.`,
    action: 'Einladung annehmen:',
    validity: 'Der Link ist 7 Tage gültig.',
    ignore: 'Nicht erwartet? Ignorieren.',
  },
  en: {
    subject: (inviter: string, household: string) => `${inviter} invites you to “${household}”`,
    intro: (inviter: string, household: string) =>
      `${inviter} has invited you to the household “${household}” in Smart Home.`,
    action: 'Accept the invitation:',
    validity: 'The link is valid for 7 days.',
    ignore: 'Not expected? Ignore this mail.',
  },
} as const satisfies Record<Language, unknown>;

/** Names are user input: no line breaks in the subject, no markup in the HTML part. */
const oneLine = (value: string): string => value.replace(/\s+/g, ' ').trim();
const escapeHtml = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

/** The invitation mail. The link is built by the caller from a random token, so it is URL safe. */
export function invitation(locale: Language, details: InvitationDetails): InvitationMail {
  const t = texts[locale];
  const inviter = oneLine(details.inviterName);
  const household = oneLine(details.householdName);
  const { link } = details;
  return {
    subject: t.subject(inviter, household),
    text: `${t.intro(inviter, household)}\n\n${t.action}\n${link}\n\n${t.validity}\n${t.ignore}\n`,
    html: [
      `<!doctype html><html lang="${locale}"><body style="font-family: sans-serif; color: #1c1b1f">`,
      `<p>${escapeHtml(t.intro(inviter, household))}</p>`,
      `<p><a href="${escapeHtml(link)}">${t.action.replace(/:$/, '')}</a></p>`,
      `<p>${t.validity}</p>`,
      `<p style="color: #605d62">${t.ignore}</p>`,
      '</body></html>',
    ].join(''),
  };
}
