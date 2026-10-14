import type { NextFunction, Request, Response } from 'express';

/** API responses carry personal data and session state; browsers and proxies must not keep them. */
export function noStore(_request: Request, response: Response, next: NextFunction): void {
  response.setHeader('Cache-Control', 'no-store');
  next();
}
