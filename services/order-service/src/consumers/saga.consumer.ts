import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import {
  Topics,
  EventEnvelope,
  PaymentCompletedPayload,
  PaymentFailedPayload,
  InventoryReservedPayload,
  InventoryRejectedPayload,
} from '@ecommerce/shared';
import { PrismaService } from '../prisma/prisma.service';
import { KafkaConsumerService } from '../kafka/kafka-consumer.service';
import { OrdersService } from '../orders/orders.service';
import { processOnce } from './idempotent-consumer';

const CONSUMER = 'order-service.saga';

/**
 * Drives the choreography saga from the Order Service's side.
 *
 * It listens to the OUTCOMES of the two parallel legs and records them. When
 * both legs are decided, OrdersService settles the order (CONFIRMED or
 * CANCELLED) and stages the resulting event in the outbox.
 *
 * Every handler is wrapped in `processOnce` (Layer 3), so a redelivered
 * payments.completed can never advance the saga twice.
 */
@Injectable()
export class SagaConsumer implements OnModuleInit {
  private readonly logger = new Logger(SagaConsumer.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly consumer: KafkaConsumerService,
    private readonly orders: OrdersService,
  ) {}

  onModuleInit(): void {
    this.consumer.subscribeHandler(Topics.PAYMENTS_COMPLETED, (e) => this.onPaymentCompleted(e));
    this.consumer.subscribeHandler(Topics.PAYMENTS_FAILED, (e) => this.onPaymentFailed(e));
    this.consumer.subscribeHandler(Topics.INVENTORY_RESERVED, (e) => this.onInventoryReserved(e));
    this.consumer.subscribeHandler(Topics.INVENTORY_REJECTED, (e) => this.onInventoryRejected(e));
    // The consumer is actually started in main.ts after all handlers are registered.
  }

  private onPaymentCompleted(event: EventEnvelope): Promise<void> {
    const { orderId } = event.payload as PaymentCompletedPayload;
    return processOnce(this.prisma, CONSUMER, event, this.logger, (tx) =>
      this.orders.applyLegOutcome(tx, orderId, 'payment', 'SUCCEEDED'),
    );
  }

  private onPaymentFailed(event: EventEnvelope): Promise<void> {
    const { orderId } = event.payload as PaymentFailedPayload;
    return processOnce(this.prisma, CONSUMER, event, this.logger, (tx) =>
      this.orders.applyLegOutcome(tx, orderId, 'payment', 'FAILED'),
    );
  }

  private onInventoryReserved(event: EventEnvelope): Promise<void> {
    const { orderId } = event.payload as InventoryReservedPayload;
    return processOnce(this.prisma, CONSUMER, event, this.logger, (tx) =>
      this.orders.applyLegOutcome(tx, orderId, 'inventory', 'SUCCEEDED'),
    );
  }

  private onInventoryRejected(event: EventEnvelope): Promise<void> {
    const { orderId } = event.payload as InventoryRejectedPayload;
    return processOnce(this.prisma, CONSUMER, event, this.logger, (tx) =>
      this.orders.applyLegOutcome(tx, orderId, 'inventory', 'FAILED'),
    );
  }
}
