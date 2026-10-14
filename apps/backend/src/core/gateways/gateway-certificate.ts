import { X509Certificate } from 'node:crypto';
import { HttpStatus } from '@nestjs/common';
import { GATEWAY_ID_PATTERN } from '@smart/contracts';
import { ApiError } from '../../platform/http/index.js';

/** What is kept of a gateway's certificate: nothing else is stored or logged. */
export interface GatewayCertificate {
  id: string;
  expiresAt: Date;
  /** SHA-256 of the certificate. */
  fingerprint: string;
}

const invalid = (): ApiError => new ApiError(HttpStatus.BAD_REQUEST, 'gateway.invalidCertificate');

/**
 * The gateway ID in the subject: the value of the one and only `CN=` line (Node prints one
 * attribute per line and writes a multi-valued RDN as `A=… + B=…`, so a CN hidden in one never
 * starts a line). The caller checks the pattern.
 */
const commonName = (subject: string): string => {
  const names = subject.split('\n').filter((line) => line.startsWith('CN='));
  return names.length === 1 ? (names[0]?.slice('CN='.length) ?? '') : '';
};

/** Parses the pasted public certificate; never echoes or keeps anything but id, expiry and fingerprint. */
export function readGatewayCertificate(
  pem: string,
  ca: X509Certificate,
  now: Date,
): GatewayCertificate {
  if (/PRIVATE KEY/.test(pem)) throw invalid();
  const blocks = pem
    .replace(/\r\n/g, '\n')
    .match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
  // Exactly one certificate: a pasted chain would make it unclear which one is the gateway's.
  if (blocks?.length !== 1) throw invalid();
  let cert: X509Certificate;
  try {
    cert = new X509Certificate(blocks[0]);
  } catch {
    throw invalid();
  }
  const id = commonName(cert.subject);
  const valid =
    cert.verify(ca.publicKey) &&
    cert.checkIssued(ca) &&
    GATEWAY_ID_PATTERN.test(id) &&
    new Date(cert.validFrom) <= now &&
    new Date(cert.validTo) > now;
  if (!valid) throw invalid();
  return { id, expiresAt: new Date(cert.validTo), fingerprint: cert.fingerprint256 };
}
