import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { Topics, EventEnvelope, OrderCreatedPayload } from '@ecommerce/shared';
import { PrismaService } from '../prisma/prisma.service';
import { KafkaConsumerService } from '../kafka/kafka-consumer.service';
import { PaymentsService } from './payments.service';
import { processOnce } from '../common/idempotent-consumer';

const CONSUMER = 'payment-service.orders';

/** Listens for new orders and charges them (idempotently). */
@Injectable()
export class OrderEventsConsumer implements OnModuleInit {
  private readonly logger = new Logger(OrderEventsConsumer.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly consumer: KafkaConsumerService,
    private readonly payments: PaymentsService,
  ) {}

  onModuleInit(): void {
    this.consumer.subscribeHandler(Topics.ORDERS_CREATED, (e) => this.onOrderCreated(e));
  }

  private onOrderCreated(event: EventEnvelope): Promise<void> {
    const order = event.payload as OrderCreatedPayload;
    return processOnce(this.prisma, CONSUMER, event, this.logger, (tx) =>
      this.payments.charge(tx, order, event.correlationId),
    );
  }
}
