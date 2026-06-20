import {
  Injectable,
  ConflictException,
  UnprocessableEntityException,
  Logger,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { ConfigService } from '@nestjs/config';

export interface IdempotentResult<T> {
  /** The response to return to the client. */
  response: T;
  statusCode: number;
  /** True when this is a replay of a previously completed request. */
  replayed: boolean;
}

const IN_PROGRESS = 'IN_PROGRESS';
const COMPLETED = 'COMPLETED';

/**
 * Layer 1 — HTTP request idempotency.
 *
 * Guarantees that repeating a request with the same `Idempotency-Key` produces
 * the same result and the side effect (creating an order) happens at most once.
 *
 * The work itself runs inside a Prisma transaction that the caller provides via
 * `work(tx)`. The idempotency-key row is written in that SAME transaction, so the
 * key and the order commit atomically — no window where the order exists but the
 * key wasn't recorded (which would let a retry create a second order).
 */
@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);
  private readonly ttlSeconds: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    config: ConfigService,
  ) {
    this.ttlSeconds = config.get<number>('idempotencyTtlSeconds')!;
  }

  static hashBody(body: unknown): string {
    return createHash('sha256').update(JSON.stringify(body ?? {})).digest('hex');
  }

  private redisKey(key: string): string {
    return `idem:${key}`;
  }

  /**
   * Execute `work` exactly once for a given key.
   *
   * @param key         the client-supplied Idempotency-Key (UUID)
   * @param requestBody used to detect a key reused with a different payload (-> 422)
   * @param work        the side-effecting handler; receives the transaction client
   *                    AND must return the response to cache + its HTTP status code
   */
  async execute<T>(
    key: string,
    requestBody: unknown,
    work: (tx: Prisma.TransactionClient) => Promise<{ response: T; statusCode: number }>,
  ): Promise<IdempotentResult<T>> {
    const requestHash = IdempotencyService.hashBody(requestBody);

    // ── Fast path: a completed key cached in Redis ──────────────────────────
    const cached = await this.redis.get(this.redisKey(key));
    if (cached) {
      const parsed = JSON.parse(cached) as { hash: string; response: T; statusCode: number };
      this.assertSameBody(parsed.hash, requestHash);
      return { response: parsed.response, statusCode: parsed.statusCode, replayed: true };
    }

    // ── Source of truth: Postgres ───────────────────────────────────────────
    const existing = await this.prisma.idempotencyKey.findUnique({ where: { key } });
    if (existing) {
      return this.handleExisting<T>(existing, requestHash, key);
    }

    // ── New key: do the work and record the key in ONE transaction ──────────
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        // Claim the key first. If a concurrent request already claimed it, the
        // unique constraint throws P2002 and we fall to the catch below.
        await tx.idempotencyKey.create({
          data: { key, requestHash, status: IN_PROGRESS },
        });

        const { response, statusCode } = await work(tx);

        await tx.idempotencyKey.update({
          where: { key },
          data: {
            status: COMPLETED,
            response: response as unknown as Prisma.InputJsonValue,
            statusCode,
            expiresAt: new Date(Date.now() + this.ttlSeconds * 1000),
          },
        });
        return { response, statusCode };
      });

      // Populate the Redis fast path (best-effort).
      await this.redis.setEx(
        this.redisKey(key),
        JSON.stringify({ hash: requestHash, response: result.response, statusCode: result.statusCode }),
        this.ttlSeconds,
      );

      return { ...result, replayed: false };
    } catch (err) {
      // Concurrent insert of the same key -> treat as a duplicate request.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const row = await this.prisma.idempotencyKey.findUnique({ where: { key } });
        if (row) return this.handleExisting<T>(row, requestHash, key);
      }
      throw err;
    }
  }

  private handleExisting<T>(
    row: { requestHash: string; status: string; response: unknown; statusCode: number | null },
    requestHash: string,
    key: string,
  ): IdempotentResult<T> {
    this.assertSameBody(row.requestHash, requestHash);

    if (row.status === COMPLETED) {
      this.logger.debug(`Replaying cached response for key ${key}`);
      return {
        response: row.response as T,
        statusCode: row.statusCode ?? 200,
        replayed: true,
      };
    }

    // Still IN_PROGRESS: the original request hasn't finished. Tell the client to retry.
    throw new ConflictException('A request with this Idempotency-Key is already in progress.');
  }

  /** Same key + different body is a client bug we surface loudly. */
  private assertSameBody(storedHash: string, requestHash: string): void {
    if (storedHash !== requestHash) {
      throw new UnprocessableEntityException(
        'Idempotency-Key was already used with a different request body.',
      );
    }
  }
}
