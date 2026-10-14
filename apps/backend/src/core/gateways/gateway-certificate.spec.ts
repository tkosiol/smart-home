import { X509Certificate } from 'node:crypto';
import { HttpStatus } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiError } from '../../platform/http/index.js';
import { createTestCa, type TestCa } from '../../../test/helpers/test-pki.js';
import { readGatewayCertificate } from './gateway-certificate.js';

describe('readGatewayCertificate', () => {
  let ca: TestCa;
  let caCert: X509Certificate;
  const now = new Date();

  beforeAll(() => {
    ca = createTestCa();
    caCert = new X509Certificate(ca.certificate);
  });
  afterAll(() => ca.dispose());

  const rejects = (pem: string, authority = caCert): void => {
    try {
      readGatewayCertificate(pem, authority, now);
      expect.unreachable('the certificate must be rejected');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).getStatus()).toBe(HttpStatus.BAD_REQUEST);
      expect((error as ApiError).code).toBe('gateway.invalidCertificate');
    }
  };

  it('reads id, expiry and fingerprint of a certificate issued by the CA', () => {
    const issued = ca.issue();
    const x509 = new X509Certificate(issued.certificate);
    expect(readGatewayCertificate(issued.certificate, caCert, now)).toEqual({
      id: issued.id,
      expiresAt: new Date(x509.validTo),
      fingerprint: x509.fingerprint256,
    });
  });

  it('accepts CRLF line breaks and blank lines around the block', () => {
    const issued = ca.issue();
    const padded = `\n\n  ${issued.certificate.trim().replaceAll('\n', '\r\n')}\r\n\r\n`;
    expect(readGatewayCertificate(padded, caCert, now).id).toBe(issued.id);
  });

  it('rejects a chain of two certificates', () => {
    const first = ca.issue();
    const second = ca.issue();
    rejects(`${first.certificate}${second.certificate}`);
    rejects(`${first.certificate}${ca.certificate}`);
  });

  it('rejects anything with a private key, even next to a valid certificate', () => {
    const issued = ca.issue();
    rejects(`${issued.certificate}\n${issued.privateKey}`);
    rejects(issued.privateKey);
  });

  describe('rejects a certificate that is not a client certificate', () => {
    const NO_EKU = 'basicConstraints = CA:false\nkeyUsage = critical, digitalSignature\n';
    const withEku = (eku: string): string =>
      `basicConstraints = CA:false\nkeyUsage = critical, digitalSignature\nextendedKeyUsage = ${eku}\n`;
    const CA_EXT =
      'basicConstraints = critical, CA:true\nkeyUsage = critical, keyCertSign\nextendedKeyUsage = clientAuth\n';

    it('the CA certificate itself, even under a gateway name', () => {
      const selfNamed = createTestCa('gw-a1b2c3d4');
      try {
        rejects(selfNamed.certificate, new X509Certificate(selfNamed.certificate));
      } finally {
        selfNamed.dispose();
      }
    });

    it('a CA certificate with a gateway name signed by the CA', () => {
      rejects(ca.issue({ subject: '/CN=gw-a1b2c3d4', extensions: CA_EXT }).certificate);
    });

    it('a server certificate with a gateway name', () => {
      rejects(
        ca.issue({ subject: '/CN=gw-a1b2c3d4', extensions: withEku('serverAuth') }).certificate,
      );
    });

    it('a certificate without an extended key usage', () => {
      rejects(ca.issue({ subject: '/CN=gw-a1b2c3d4', extensions: NO_EKU }).certificate);
    });

    it('but accepts a client certificate that also allows server authentication', () => {
      const issued = ca.issue({ extensions: withEku('clientAuth, serverAuth') });
      expect(readGatewayCertificate(issued.certificate, caCert, now).id).toBe(issued.id);
    });
  });

  it('rejects text without a certificate', () => {
    rejects('');
    rejects('hello');
    rejects('-----BEGIN CERTIFICATE-----\nnot base64 at all\n-----END CERTIFICATE-----\n');
  });

  it('rejects an expired and a not yet valid certificate', () => {
    rejects(ca.issue({ startsInDays: -10, endsInDays: -1 }).certificate);
    rejects(ca.issue({ startsInDays: 1, endsInDays: 30 }).certificate);
  });

  it('rejects a certificate of another CA, also one with the same subject', () => {
    const other = createTestCa();
    try {
      rejects(other.issue().certificate);
      const lookalike = createTestCa('Test CA');
      try {
        rejects(lookalike.issue().certificate);
      } finally {
        lookalike.dispose();
      }
    } finally {
      other.dispose();
    }
  });

  it('rejects names that are not gateway IDs', () => {
    rejects(ca.issue({ subject: '/CN=smart-api' }).certificate);
    rejects(ca.issue({ subject: '/CN=GW-A1B2C3D4' }).certificate);
    rejects(ca.issue({ subject: '/CN=gw-a1b2c3d' }).certificate);
    rejects(ca.issue({ subject: '/CN=gw-a1b2c3d45' }).certificate);
  });

  it('counts only an exact CN attribute of the subject', () => {
    // CN hidden in a multi-valued RDN, a second CN, an O that looks like a CN, and a CN with a suffix.
    rejects(ca.issue({ subject: '/CN=gw-a1b2c3d4+O=extra' }).certificate);
    rejects(ca.issue({ subject: '/CN=gw-a1b2c3d4/CN=gw-e5f6a7b8' }).certificate);
    rejects(ca.issue({ subject: '/O=CN=gw-a1b2c3d4/CN=smart-api' }).certificate);
    rejects(ca.issue({ subject: '/CN=gw-a1b2c3d4 ' }).certificate);
    expect(
      readGatewayCertificate(
        ca.issue({ subject: '/O=Home/CN=gw-a1b2c3d4' }).certificate,
        caCert,
        now,
      ).id,
    ).toBe('gw-a1b2c3d4');
  });
});
