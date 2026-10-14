import { parseConfig } from './config.js';
import { loadFixtureDevices } from './fixtures.js';
import { Gateway } from './gateway.js';

function main(): void {
  let config;
  try {
    config = parseConfig(process.env);
  } catch (error) {
    console.error(
      `gateway-simulator: ${error instanceof Error ? error.message : 'invalid configuration'}`,
    );
    process.exit(2);
  }
  const gateway = new Gateway(config, loadFixtureDevices());
  console.log(
    `gateway-simulator: gateway ${config.gatewayId}, reporting every ${config.intervalSeconds} s`,
  );

  let stopping = false;
  const stop = (): void => {
    if (stopping) return;
    stopping = true;
    gateway.stop().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

main();
