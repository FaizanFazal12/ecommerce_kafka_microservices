import { Injectable, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, Consumer, EachMessagePayload } from 'kafkajs';
import { EventEnvelope } from '@ecommerce/shared';

export type EventHandler = (event: EventEnvelope) => Promise<void>;

/**
 * At-least-once delivery to handlers (offset commits after the handler returns).
 * Dedup is the handler's responsibility (ProcessedEvent table, Layer 3).
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
    this.consumer = this.kafka.consumer({ groupId: config.get<string>('kafka.consumerGroup')! });
  }

  subscribeHandler(topic: string, handler: EventHandler): void {
    this.routes.set(topic, handler);
  }

  async start(): Promise<void> {
    if (this.routes.size === 0) return;
    await this.consumer.connect();
    for (const topic of this.routes.keys()) {
      await this.consumer.subscribe({ topic, fromBeginning: false });
    }
    await this.consumer.run({ eachMessage: (p) => this.dispatch(p) });
    this.logger.log(`Consuming topics: ${[...this.routes.keys()].join(', ')}`);
  }

  private async dispatch({ topic, message }: EachMessagePayload): Promise<void> {
    const handler = this.routes.get(topic);
    if (!handler || !message.value) return;
    let event: EventEnvelope;
    try {
      event = JSON.parse(message.value.toString()) as EventEnvelope;
    } catch (err) {
      this.logger.error(`Bad message on ${topic}, skipping: ${(err as Error).message}`);
      return;
    }
    await handler(event); // throwing prevents offset commit -> redelivery
  }

  async onModuleDestroy(): Promise<void> {
    await this.consumer.disconnect().catch(() => undefined);
  }
}
