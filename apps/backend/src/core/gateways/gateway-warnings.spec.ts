import { describe, expect, it } from 'vitest';
import { gatewayWarnings } from './gateway-warnings.js';

const NOW = new Date('2026-10-14T12:00:00Z');
const inDays = (days: number): Date => new Date(NOW.getTime() + days * 86_400_000);

describe('gatewayWarnings', () => {
  it('has no warning for a certificate that is valid for a long time', () => {
    expect(gatewayWarnings(inDays(400), undefined, NOW)).toEqual([]);
    expect(gatewayWarnings(inDays(30), inDays(30), NOW)).toEqual([]);
  });

  it('warns 30 days before the certificate expires', () => {
    expect(gatewayWarnings(inDays(29.9), undefined, NOW)).toEqual(['certExpiring']);
    expect(gatewayWarnings(inDays(1), undefined, NOW)).toEqual(['certExpiring']);
  });

  it('reports an expired certificate as expired only', () => {
    expect(gatewayWarnings(NOW, undefined, NOW)).toEqual(['certExpired']);
    expect(gatewayWarnings(inDays(-5), undefined, NOW)).toEqual(['certExpired']);
  });

  it('warns about the CRL when it is due within 30 days or already overdue', () => {
    expect(gatewayWarnings(inDays(400), inDays(29), NOW)).toEqual(['crlExpiring']);
    expect(gatewayWarnings(inDays(400), inDays(-1), NOW)).toEqual(['crlExpiring']);
    expect(gatewayWarnings(inDays(10), inDays(10), NOW)).toEqual(['certExpiring', 'crlExpiring']);
  });
});
