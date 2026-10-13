/** Where the stack under test answers; `infra/compose/test/stack-test.sh` sets both. */
export const BASE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:18080';
/** The mail catcher of the stack test (its API, not the SMTP port). */
export const MAILPIT_URL = process.env.E2E_MAILPIT_URL ?? 'http://127.0.0.1:18025';
