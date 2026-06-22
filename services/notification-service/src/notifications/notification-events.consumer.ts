import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import {
  Topics,
  EventEnvelope,
  OrderConfirmedPayload,
  PaymentFailedPayload,
} from '@ecommerce/shared';
import { PrismaService } from '../prisma/prisma.service';
import { KafkaConsumerService } from '../kafka/kafka-consumer.service';
import { NotificationsService } from './notifications.service';
import { processOnce } from '../common/idempotent-consumer';

const CONSUMER = 'notification-service.notifications';

/** Terminal consumer: turns saga outcomes into customer notifications. */
@Injectable()
export class NotificationEventsConsumer implements OnModuleInit {
  private readonly logger = new Logger(NotificationEventsConsumer.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly consumer: KafkaConsumerService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit(): void {
    this.consumer.subscribeHandler(Topics.ORDERS_CONFIRMED, (e) => this.onOrderConfirmed(e));
    this.consumer.subscribeHandler(Topics.PAYMENTS_FAILED, (e) => this.onPaymentFailed(e));
  }

  private onOrderConfirmed(event: EventEnvelope): Promise<void> {
    const order = event.payload as OrderConfirmedPayload;
    return processOnce(this.prisma, CONSUMER, event, this.logger, (tx) =>
      this.notifications.sendOrderConfirmed(tx, order),
    );
  }

  private onPaymentFailed(event: EventEnvelope): Promise<void> {
    const failure = event.payload as PaymentFailedPayload;
    return processOnce(this.prisma, CONSUMER, event, this.logger, (tx) =>
      this.notifications.sendPaymentFailed(tx, failure),
    );
  }
}
