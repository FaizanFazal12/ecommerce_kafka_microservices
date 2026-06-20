import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, Consumer, EachMessagePayload } from 'kafkajs';
import { EventEnvelope } from '@ecommerce/shared';

export type EventHandler = (event: EventEnvelope) => Promise<void>;

/**
 * Manages the service's Kafka consumer.
 *
 * Important: this layer does NOT dedup. It guarantees AT-LEAST-ONCE delivery to
 * the handler — offsets are committed only after the handler returns. Dedup is
 * the handler's job (the ProcessedEvent table, Layer 3), because only the
 * handler knows the transaction boundary that must include the dedup insert.
 *
 * A handler that throws does NOT commit the offset, so the message is redelivered
 * (and the DLQ policy — omitted here for brevity — would kick in after N tries).
 */
@Injectable()
export class KafkaConsumerService implements OnModuleDestroy {
  private readonly logger = new Logger(KafkaConsumerService.name);
  private readonly kafka: Kafka;
  private readonly consumer: Consumer;
  private readonly routes = new Map<string, EventHandler>();

  constructor(config: ConfigService) {
    this.kafka = new Kafka({
      clientId: config.get<string>('kafka.clientId'),
      brokers: config.get<string[]>('kafka.brokers')!,
    });
    this.consumer = this.kafka.consumer({
      groupId: config.get<string>('kafka.consumerGroup')!,
    });
  }

  /** Register a handler for a topic. Call before `start()`. */
  subscribeHandler(topic: string, handler: EventHandler): void {
    this.routes.set(topic, handler);
  }

  /** Connect, subscribe to all registered topics, and begin consuming. */
  async start(): Promise<void> {
    if (this.routes.size === 0) return;
    await this.consumer.connect();
    for (const topic of this.routes.keys()) {
      await this.consumer.subscribe({ topic, fromBeginning: false });
    }
    await this.consumer.run({
      eachMessage: (payload) => this.dispatch(payload),
    });
    this.logger.log(`Consuming topics: ${[...this.routes.keys()].join(', ')}`);
  }

  private async dispatch({ topic, message }: EachMessagePayload): Promise<void> {
    const handler = this.routes.get(topic);
    if (!handler || !message.value) return;

    let event: EventEnvelope;
    try {
      event = JSON.parse(message.value.toString()) as EventEnvelope;
    } catch (err) {
      // Unparseable payload is a poison message — log and skip (would go to DLQ).
      this.logger.error(`Bad message on ${topic}, skipping: ${(err as Error).message}`);
      return;
    }

    // Throwing here intentionally prevents the offset commit -> redelivery.
    await handler(event);
  }

  async onModuleDestroy(): Promise<void> {
    await this.consumer.disconnect().catch(() => undefined);
  }
}
