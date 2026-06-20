import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, Producer } from 'kafkajs';

@Injectable()
export class KafkaProducerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaProducerService.name);
  private readonly kafka: Kafka;
  private readonly producer: Producer;

  constructor(config: ConfigService) {
    this.kafka = new Kafka({
      clientId: config.get<string>('kafka.clientId'),
      brokers: config.get<string[]>('kafka.brokers')!,
    });
    this.producer = this.kafka.producer({ idempotent: true, maxInFlightRequests: 1 });
  }

  async onModuleInit(): Promise<void> {
    await this.producer.connect();
    this.logger.log('Kafka producer connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.producer.disconnect();
  }

  async publish(topic: string, key: string, value: unknown): Promise<void> {
    await this.producer.send({
      topic,
      acks: -1,
      messages: [{ key, value: JSON.stringify(value) }],
    });
  }
}
