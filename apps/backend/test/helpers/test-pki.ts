import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Throwaway certificates for tests, generated with OpenSSL 3 at run time: no key or PEM text is
 * ever stored in the repository. Validity windows are set with `openssl ca -startdate/-enddate`
 * (available since OpenSSL 3.0, unlike `-not_before`, which needs 3.4); that is also how an
 * expired or not yet valid certificate is made.
 */
const CANDIDATES = [
  'openssl',
  '/opt/homebrew/opt/openssl@3/bin/openssl',
  '/usr/local/opt/openssl@3/bin/openssl',
];

const findOpenssl = (): string => {
  const candidates = process.env['SMART_OPENSSL'] ? [process.env['SMART_OPENSSL']] : CANDIDATES;
  for (const candidate of candidates) {
    try {
      const version = execFileSync(candidate, ['version'], { encoding: 'utf8' });
      if (/^OpenSSL [3-9]/.test(version)) return candidate;
    } catch {
      // not installed under this name
    }
  }
  throw new Error('OpenSSL 3 or newer is required for the tests (set SMART_OPENSSL)');
};

const OPENSSL = findOpenssl();
const run = (args: string[]): void => {
  execFileSync(OPENSSL, args, { stdio: ['ignore', 'ignore', 'pipe'] });
};

const asn1Time = (date: Date): string =>
  `${date.toISOString().slice(0, 19).replaceAll(/[-:T]/g, '')}Z`;

const DAY_MS = 86_400_000;

/** What `pki.sh issue-gateway` puts into a gateway certificate. */
const CLIENT_EXTENSIONS = `basicConstraints = CA:false
keyUsage = critical, digitalSignature
extendedKeyUsage = clientAuth
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid
`;

export const randomGatewayId = (): string => `gw-${randomBytes(6).toString('hex').slice(0, 8)}`;

export interface IssueOptions {
  /** The complete subject DN, e.g. `/CN=gw-a1b2c3d4`; defaults to a fresh gateway ID. */
  subject?: string;
  /** Days relative to now; defaults to a certificate valid for one year that started yesterday. */
  startsInDays?: number;
  endsInDays?: number;
  /** Replaces the extension lines of a client certificate (`openssl x509` extfile syntax). */
  extensions?: string;
}

export interface IssuedCertificate {
  id: string;
  certificate: string;
  /** The private key, only for tests that must prove a pasted key is rejected. */
  privateKey: string;
}

export interface TestCa {
  /** Path of the CA certificate, to be used as `GATEWAY_CA_FILE`. */
  file: string;
  certificate: string;
  dir: string;
  issue(options?: IssueOptions): IssuedCertificate;
  /** Removes the temporary directory with the CA key. */
  dispose(): void;
}

/** A new CA in a temporary directory. */
export function createTestCa(name = 'Test CA'): TestCa {
  const dir = mkdtempSync(join(tmpdir(), 'smart-test-pki-'));
  mkdirSync(join(dir, 'newcerts'));
  writeFileSync(join(dir, 'index.txt'), '');
  writeFileSync(join(dir, 'serial'), `00${randomBytes(8).toString('hex')}\n`);
  const config = join(dir, 'openssl.cnf');
  writeFileSync(
    config,
    `[ ca ]
default_ca = test_ca
[ test_ca ]
database = ${dir}/index.txt
serial = ${dir}/serial
new_certs_dir = ${dir}/newcerts
certificate = ${dir}/ca.crt
private_key = ${dir}/ca.key
default_md = sha256
unique_subject = no
policy = policy_any
copy_extensions = none
[ policy_any ]
commonName = supplied
[ req ]
distinguished_name = req_dn
prompt = no
[ req_dn ]
CN = placeholder
[ v3_ca ]
basicConstraints = critical, CA:true
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash
`,
  );
  const newKey = (path: string): void =>
    run([
      'genpkey',
      '-algorithm',
      'EC',
      '-pkeyopt',
      'ec_paramgen_curve:P-256',
      '-pkeyopt',
      'ec_param_enc:named_curve',
      '-out',
      path,
    ]);
  newKey(join(dir, 'ca.key'));
  run([
    'req',
    '-new',
    '-x509',
    '-config',
    config,
    '-key',
    join(dir, 'ca.key'),
    '-subj',
    `/CN=${name}`,
    '-days',
    '3650',
    '-extensions',
    'v3_ca',
    '-out',
    join(dir, 'ca.crt'),
  ]);
  let counter = 0;
  return {
    dir,
    file: join(dir, 'ca.crt'),
    certificate: readFileSync(join(dir, 'ca.crt'), 'utf8'),
    dispose: () => {
      rmSync(dir, { recursive: true, force: true });
    },
    issue: ({ subject, startsInDays = -1, endsInDays = 365, extensions } = {}) => {
      counter += 1;
      const id = randomGatewayId();
      const key = join(dir, `leaf${counter}.key`);
      const csr = join(dir, `leaf${counter}.csr`);
      const out = join(dir, `leaf${counter}.crt`);
      const extfile = join(dir, `leaf${counter}.ext`);
      writeFileSync(extfile, extensions ?? CLIENT_EXTENSIONS);
      newKey(key);
      run([
        'req',
        '-new',
        '-config',
        config,
        '-key',
        key,
        '-subj',
        subject ?? `/CN=${id}`,
        '-out',
        csr,
      ]);
      const now = Date.now();
      run([
        'ca',
        '-batch',
        '-notext',
        '-config',
        config,
        '-preserveDN',
        '-startdate',
        asn1Time(new Date(now + startsInDays * DAY_MS)),
        '-enddate',
        asn1Time(new Date(now + endsInDays * DAY_MS)),
        '-md',
        'sha256',
        '-in',
        csr,
        '-out',
        out,
        '-extfile',
        extfile,
      ]);
      return {
        id,
        certificate: readFileSync(out, 'utf8'),
        privateKey: readFileSync(key, 'utf8'),
      };
    },
  };
}
