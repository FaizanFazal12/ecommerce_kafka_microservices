import {
  CanActivate,
  ExecutionContext,
  Injectable,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { RedisService } from '../redis/redis.service';
import { AuthedRequest } from '../auth/auth.types';

/**
 * Distributed fixed-window rate limiter backed by Redis.
 *
 * The counter lives in Redis (not in process memory), so the limit is enforced
 * ACROSS all gateway instances — essential once you scale the gateway
 * horizontally. Keyed by authenticated customer when available, else client IP.
 *
 * Fails OPEN: if Redis is unreachable we allow the request rather than block
 * checkout. At the edge, availability beats strict enforcement.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);
  private readonly max: number;
  private readonly windowSeconds: number;

  constructor(
    config: ConfigService,
    private readonly redis: RedisService,
  ) {
    this.max = config.get<number>('rateLimit.max')!;
    this.windowSeconds = config.get<number>('rateLimit.windowSeconds')!;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const res = context.switchToHttp().getResponse<Response>();

    if (!this.redis.isHealthy()) return true; // fail open

    const identity = req.user?.customerId ?? req.ip ?? 'anonymous';
    const windowId = `${identity}`;
    const key = `rl:${windowId}`;

    let count: number;
    let ttl: number;
    try {
      ({ count, ttl } = await this.redis.incrementWindow(key, this.windowSeconds));
    } catch (err) {
      this.logger.warn(`Rate-limit check failed, allowing: ${(err as Error).message}`);
      return true; // fail open
    }

    const remaining = Math.max(0, this.max - count);
    res.setHeader('X-RateLimit-Limit', this.max);
    res.setHeader('X-RateLimit-Remaining', remaining);
    res.setHeader('X-RateLimit-Reset', ttl);

    if (count > this.max) {
      res.setHeader('Retry-After', ttl);
      throw new HttpException(
        { statusCode: HttpStatus.TOO_MANY_REQUESTS, message: 'Rate limit exceeded' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
