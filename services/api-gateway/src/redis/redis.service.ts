import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Redis client for rate-limit counters. Exposes a small atomic helper used by the
 * rate-limit guard. If Redis is down the guard fails OPEN (allows traffic) rather
 * than blocking checkout — availability over strict enforcement at the edge.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client!: Redis;
  private healthy = false;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    this.client = new Redis(this.config.get<string>('redisUrl')!, { maxRetriesPerRequest: 2 });
    this.client.on('ready', () => {
      this.healthy = true;
      this.logger.log('Connected to Redis');
    });
    this.client.on('error', (err) => {
      this.healthy = false;
      this.logger.warn(`Redis unavailable (rate limiting fails open): ${err.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.quit().catch(() => undefined);
  }

  isHealthy(): boolean {
    return this.healthy;
  }

  /**
   * Fixed-window counter. Increments the key and, on the first hit of a window,
   * sets its TTL. Returns the current count and the seconds left in the window.
   * One round-trip via a pipeline keeps it cheap.
   */
  async incrementWindow(key: string, windowSeconds: number): Promise<{ count: number; ttl: number }> {
    const results = await this.client
      .multi()
      .incr(key)
      .expire(key, windowSeconds, 'NX') // set TTL only if not already set (start of window)
      .ttl(key)
      .exec();
    // results: [[err, count], [err, _], [err, ttl]]
    const count = Number(results?.[0]?.[1] ?? 0);
    const ttl = Number(results?.[2]?.[1] ?? windowSeconds);
    return { count, ttl: ttl < 0 ? windowSeconds : ttl };
  }
}
