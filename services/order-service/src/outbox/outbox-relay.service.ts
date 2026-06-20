import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { KafkaProducerService } from '../kafka/kafka-producer.service';

/**
 * The polling RELAY (Layer 2, read side).
 *
 * On an interval it:
 *   1. reads a batch of unpublished outbox rows, oldest first
 *   2. publishes each to Kafka and waits for the broker ACK
 *   3. marks the row published ONLY after the ACK
 *
 * Crash safety: if we die after the ACK but before the mark, the row stays
 * unpublished and is re-sent next tick. That's the deliberate AT-LEAST-ONCE
 * guarantee — consumers dedup (Layer 3), so a duplicate publish is harmless.
 *
 * We never mark a row published before its ACK, which would risk losing an event.
 */
@Injectable()
export class OutboxRelayService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelayService.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  private stopped = false;
  private readonly intervalMs: number;
  private readonly batchSize: number;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly producer: KafkaProducerService,
  ) {
    this.intervalMs = config.get<number>('outbox.pollIntervalMs')!;
    this.batchSize = config.get<number>('outbox.batchSize')!;
  }

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.logger.log(`Outbox relay started (every ${this.intervalMs}ms, batch ${this.batchSize})`);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }

  /** One poll cycle. Guarded so ticks never overlap if a batch runs long. */
  private async tick(): Promise<void> {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      await this.drainBatch();
    } catch (err) {
      // Transient broker/DB errors: log and retry next tick. Rows stay unpublished.
      this.logger.error(`Relay tick failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  private async drainBatch(): Promise<void> {
    const batch = await this.prisma.outboxEvent.findMany({
      where: { publishedAt: null },
      orderBy: { createdAt: 'asc' },
      take: this.batchSize,
    });
    if (batch.length === 0) return;

    for (const row of batch) {
      // Publish first; only mark published after the broker confirms.
      await this.producer.publish(row.topic, row.partitionKey, row.payload);
      await this.prisma.outboxEvent.update({
        where: { id: row.id },
        data: { publishedAt: new Date() },
      });
    }
    this.logger.debug(`Published ${batch.length} outbox event(s)`);
  }
}
