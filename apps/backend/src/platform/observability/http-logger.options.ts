import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { stdSerializers, type Options } from 'pino-http';

/** Capability URLs: this path segment is a bearer secret and must not reach a log line. */
const SECRET_SEGMENTS = /(\/invitations\/)[^/?#]+/;
const redactUrl = (url: string): string => url.replace(SECRET_SEGMENTS, '$1[redacted]');

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
      req: (req: IncomingMessage) => {
        const serialized = stdSerializers.req(req);
        return { ...serialized, url: redactUrl(serialized.url) };
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
