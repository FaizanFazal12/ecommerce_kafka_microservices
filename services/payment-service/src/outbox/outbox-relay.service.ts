import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { KafkaProducerService } from '../kafka/kafka-producer.service';

/**
 * Polling relay (Layer 2, read side). Publishes unpublished outbox rows to Kafka
 * and marks them published only after the broker ACK (at-least-once).
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
    this.logger.log(`Outbox relay started (every ${this.intervalMs}ms)`);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      const batch = await this.prisma.outboxEvent.findMany({
        where: { publishedAt: null },
        orderBy: { createdAt: 'asc' },
        take: this.batchSize,
      });
      for (const row of batch) {
        await this.producer.publish(row.topic, row.partitionKey, row.payload);
        await this.prisma.outboxEvent.update({
          where: { id: row.id },
          data: { publishedAt: new Date() },
        });
      }
      if (batch.length) this.logger.debug(`Published ${batch.length} outbox event(s)`);
    } catch (err) {
      this.logger.error(`Relay tick failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
