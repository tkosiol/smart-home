import { readFileSync } from 'node:fs';

/** A gateway of the stack test and its public certificate (PEM); never the private key. */
export interface TestGateway {
  id: string;
  certificate: string;
}

/**
 * The gateways that `infra/compose/test/stack-test.sh` brings up: the bridged test Pi and the simulator.
 * The script exports their IDs and the paths of the certificates it issued from its throwaway CA.
 */
export function testGateway(which: 'pi' | 'simulator'): TestGateway {
  const prefix = which === 'pi' ? 'E2E_PI' : 'E2E_SIMULATOR';
  const id = process.env[`${prefix}_GATEWAY_ID`];
  const file = process.env[`${prefix}_CERTIFICATE_FILE`];
  if (!id || !file) {
    throw new Error(`${prefix}_GATEWAY_ID and ${prefix}_CERTIFICATE_FILE are set by stack-test.sh`);
  }
  return { id, certificate: readFileSync(file, 'utf8') };
}
