import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, Consumer, Producer, EachMessagePayload, KafkaMessage } from 'kafkajs';
import { EventEnvelope, DeadLetterEnvelope, dlqForTopic } from '@ecommerce/shared';

export type EventHandler = (event: EventEnvelope) => Promise<void>;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Manages the service's Kafka consumer, with bounded retries and a dead-letter
 * fallback.
 *
 * Delivery is at-least-once: the offset commits only after eachMessage resolves.
 * Handlers must dedup (ProcessedEvent table, Layer 3); because that dedup runs in
 * the same transaction as the work, a failed attempt rolls back cleanly and is
 * safe to RETRY.
 *
 * Failure flow for one message:
 *   attempt handler -> on throw, retry up to `maxRetries` with linear backoff
 *   -> still failing? publish a DeadLetterEnvelope to the topic's *.DLQ and
 *      RETURN normally so the offset commits. One poison message can't wedge the
 *      partition forever.
 */
@Injectable()
export class KafkaConsumerService implements OnModuleDestroy {
  private readonly logger = new Logger(KafkaConsumerService.name);
  private readonly kafka: Kafka;
  private readonly consumer: Consumer;
  private readonly dlqProducer: Producer;
  private readonly routes = new Map<string, EventHandler>();
  private readonly groupId: string;
  private readonly maxRetries: number;
  private readonly retryBackoffMs: number;

  constructor(config: ConfigService) {
    this.kafka = new Kafka({
      clientId: config.get<string>('kafka.clientId'),
      brokers: config.get<string[]>('kafka.brokers')!,
    });
    this.groupId = config.get<string>('kafka.consumerGroup')!;
    this.consumer = this.kafka.consumer({ groupId: this.groupId });
    this.dlqProducer = this.kafka.producer({ allowAutoTopicCreation: false });
    this.maxRetries = config.get<number>('consumer.maxRetries') ?? 3;
    this.retryBackoffMs = config.get<number>('consumer.retryBackoffMs') ?? 500;
  }

  subscribeHandler(topic: string, handler: EventHandler): void {
    this.routes.set(topic, handler);
  }

  async start(): Promise<void> {
    if (this.routes.size === 0) return;
    await this.dlqProducer.connect();
    await this.consumer.connect();
    for (const topic of this.routes.keys()) {
      await this.consumer.subscribe({ topic, fromBeginning: false });
    }
    await this.consumer.run({ eachMessage: (p) => this.dispatch(p) });
    this.logger.log(
      `Consuming ${[...this.routes.keys()].join(', ')} ` +
        `(retries=${this.maxRetries}, backoff=${this.retryBackoffMs}ms)`,
    );
  }

  private async dispatch({ topic, message }: EachMessagePayload): Promise<void> {
    const handler = this.routes.get(topic);
    if (!handler || !message.value) return;

    let event: EventEnvelope;
    try {
      event = JSON.parse(message.value.toString()) as EventEnvelope;
    } catch (err) {
      // Unparseable payload can never succeed — straight to the DLQ.
      this.logger.error(`Unparseable message on ${topic} -> DLQ: ${(err as Error).message}`);
      await this.toDlq(topic, message, err as Error, 0, message.value.toString());
      return;
    }

    await this.handleWithRetry(topic, event, message, handler);
  }

  private async handleWithRetry(
    topic: string,
    event: EventEnvelope,
    message: KafkaMessage,
    handler: EventHandler,
  ): Promise<void> {
    let attempt = 0;
    for (;;) {
      try {
        await handler(event);
        return;
      } catch (err) {
        attempt += 1;
        if (attempt > this.maxRetries) {
          this.logger.error(
            `Event ${event.eventId} on ${topic} failed after ${this.maxRetries} retries -> DLQ`,
          );
          await this.toDlq(topic, message, err as Error, attempt, event);
          return; // commit offset; message parked in DLQ
        }
        const backoff = this.retryBackoffMs * attempt; // linear backoff
        this.logger.warn(
          `Handler failed on ${topic} (attempt ${attempt}/${this.maxRetries}): ` +
            `${(err as Error).message}; retrying in ${backoff}ms`,
        );
        await sleep(backoff);
      }
    }
  }

  private async toDlq(
    originalTopic: string,
    message: KafkaMessage,
    err: Error,
    attempts: number,
    original: unknown,
  ): Promise<void> {
    const dlq = dlqForTopic(originalTopic);
    const deadLetter: DeadLetterEnvelope = {
      originalTopic,
      consumerGroup: this.groupId,
      failedAt: new Date().toISOString(),
      attempts,
      error: { name: err?.name, message: err?.message ?? String(err) },
      key: message.key?.toString() ?? null,
      original,
    };
    await this.dlqProducer.send({
      topic: dlq,
      messages: [{ key: message.key ?? null, value: JSON.stringify(deadLetter) }],
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.consumer.disconnect().catch(() => undefined);
    await this.dlqProducer.disconnect().catch(() => undefined);
  }
}
