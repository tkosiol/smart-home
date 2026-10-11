import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Writable } from 'node:stream';
import { pinoHttp } from 'pino-http';
import { afterEach, describe, expect, it } from 'vitest';
import { createHttpLoggerOptions } from './http-logger.options.js';

let server: Server | undefined;
afterEach(() => server?.close());

async function serve(): Promise<{ url: string; lines: () => Record<string, unknown>[] }> {
  const chunks: string[] = [];
  const sink = new Writable({
    write(chunk, _encoding, done) {
      chunks.push(String(chunk));
      done();
    },
  });
  const logger = pinoHttp(createHttpLoggerOptions('info'), sink);
  server = createServer((req, res) => {
    logger(req, res);
    res.setHeader('set-cookie', 'session=server-secret');
    res.end('ok');
  });
  await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    lines: () =>
      chunks
        .join('')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

describe('createHttpLoggerOptions', () => {
  it('redacts cookies and authorization and tags every request with a traceId', async () => {
    const { url, lines } = await serve();
    const response = await fetch(`${url}/api/things`, {
      headers: { cookie: 'session=client-secret', authorization: 'Bearer token-secret' },
    });
    const traceId = response.headers.get('x-trace-id');

    const raw = JSON.stringify(lines());
    expect(traceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(raw).toContain(traceId);
    expect(raw).not.toContain('client-secret');
    expect(raw).not.toContain('token-secret');
    expect(raw).not.toContain('server-secret');
  });

  it('does not log health probes', async () => {
    const { url, lines } = await serve();
    await fetch(`${url}/api/health/live`);
    expect(lines()).toEqual([]);
  });
});
