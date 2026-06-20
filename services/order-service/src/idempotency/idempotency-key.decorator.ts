import {
  createParamDecorator,
  ExecutionContext,
  BadRequestException,
} from '@nestjs/common';
import { Request } from 'express';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Extracts and validates the `Idempotency-Key` request header, injecting it as a
 * controller parameter. A missing or malformed key is a 400 — for a payment-bearing
 * endpoint we REQUIRE clients to opt into idempotency rather than allowing
 * unsafe-by-default retries.
 */
export const IdempotencyKey = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const req = ctx.switchToHttp().getRequest<Request>();
    const raw = req.header('Idempotency-Key');
    if (!raw) {
      throw new BadRequestException('Idempotency-Key header is required.');
    }
    if (!UUID_RE.test(raw)) {
      throw new BadRequestException('Idempotency-Key must be a UUID.');
    }
    return raw;
  },
);
