import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Response, NextFunction } from 'express';
import { AuthedRequest } from '../auth/auth.types';

/**
 * Ensures every request carries an `X-Request-Id`. If the caller didn't supply
 * one, we mint it here. It's echoed back on the response and propagated to
 * downstream services, so a single request can be traced across the whole system
 * (and tied to the saga's correlationId).
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: AuthedRequest, res: Response, next: NextFunction): void {
    const incoming = req.header('x-request-id');
    const requestId = incoming && incoming.trim() ? incoming : randomUUID();
    req.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    next();
  }
}
