import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { stdSerializers, type Options } from 'pino-http';

/** One JSON line per request; secrets redacted; health probes are not logged. */
export function createHttpLoggerOptions(level: string): Options {
  return {
    level,
    genReqId: (_req, res) => {
      const traceId = randomUUID();
      res.setHeader('x-trace-id', traceId);
      return traceId;
    },
    serializers: {
      // A page URL in the Referer may carry one-time tokens: log nothing of it.
      req: (req: IncomingMessage) => {
        const { headers, ...rest } = stdSerializers.req(req);
        const kept = Object.entries(headers).filter(([name]) => name.toLowerCase() !== 'referer');
        return { ...rest, headers: Object.fromEntries(kept) };
      },
    },
    customAttributeKeys: { reqId: 'traceId' },
    redact: {
      paths: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
      censor: '[redacted]',
    },
    autoLogging: { ignore: (req) => (req.url ?? '').startsWith('/api/health/') },
    timestamp: () => `,"time":"${new Date().toISOString()}"`,
  };
}
