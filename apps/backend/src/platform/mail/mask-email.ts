/** `till@example.org` -> `t***@example.org`; safe to log. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 0) return '***';
  const local = email.slice(0, at);
  return `${local.slice(0, 1)}***${email.slice(at)}`;
}
