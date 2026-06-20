import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import {
  Topics,
  EventEnvelope,
  OrderCreatedPayload,
  OrderCancelledPayload,
} from '@ecommerce/shared';
import { PrismaService } from '../prisma/prisma.service';
import { KafkaConsumerService } from '../kafka/kafka-consumer.service';
import { InventoryService } from './inventory.service';
import { processOnce } from '../common/idempotent-consumer';

const CONSUMER = 'inventory-service.orders';

/**
 * Listens for new orders (reserve stock) and cancellations (release stock — the
 * saga compensation). Both handlers are deduped via processOnce (Layer 3).
 */
@Injectable()
export class InventoryEventsConsumer implements OnModuleInit {
  private readonly logger = new Logger(InventoryEventsConsumer.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly consumer: KafkaConsumerService,
    private readonly inventory: InventoryService,
  ) {}

  onModuleInit(): void {
    this.consumer.subscribeHandler(Topics.ORDERS_CREATED, (e) => this.onOrderCreated(e));
    this.consumer.subscribeHandler(Topics.ORDERS_CANCELLED, (e) => this.onOrderCancelled(e));
  }

  private onOrderCreated(event: EventEnvelope): Promise<void> {
    const order = event.payload as OrderCreatedPayload;
    return processOnce(this.prisma, CONSUMER, event, this.logger, (tx) =>
      this.inventory.reserve(tx, order, event.correlationId),
    );
  }

  private onOrderCancelled(event: EventEnvelope): Promise<void> {
    const cancelled = event.payload as OrderCancelledPayload;
    return processOnce(this.prisma, CONSUMER, event, this.logger, (tx) =>
      this.inventory.release(tx, cancelled),
    );
  }
}
