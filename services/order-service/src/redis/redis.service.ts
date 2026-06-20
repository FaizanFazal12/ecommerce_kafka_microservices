import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Redis is the FAST PATH for idempotency-key lookups. It is NOT the source of
 * truth — Postgres is. If Redis is unavailable the system still works correctly,
 * just slightly slower (every check falls through to Postgres). This service is
 * therefore written to degrade gracefully.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client!: Redis;
  private healthy = false;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    this.client = new Redis(this.config.get<string>('redisUrl')!, {
      lazyConnect: false,
      maxRetriesPerRequest: 2,
    });
    this.client.on('ready', () => {
      this.healthy = true;
      this.logger.log('Connected to Redis');
    });
    this.client.on('error', (err) => {
      this.healthy = false;
      this.logger.warn(`Redis unavailable, falling back to Postgres only: ${err.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.quit().catch(() => undefined);
  }

  /** Best-effort GET. Returns null on any failure so callers fall through to Postgres. */
  async get(key: string): Promise<string | null> {
    if (!this.healthy) return null;
    try {
      return await this.client.get(key);
    } catch {
      return null;
    }
  }

  /** Best-effort SET with TTL. Silently ignored if Redis is down. */
  async setEx(key: string, value: string, ttlSeconds: number): Promise<void> {
    if (!this.healthy) return;
    try {
      await this.client.set(key, value, 'EX', ttlSeconds);
    } catch {
      /* fast-path only — safe to ignore */
    }
  }
}
