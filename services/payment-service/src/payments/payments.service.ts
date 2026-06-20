import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import {
  createEvent,
  Topics,
  OrderCreatedPayload,
  PaymentCompletedPayload,
  PaymentFailedPayload,
} from '@ecommerce/shared';
import { OutboxService } from '../outbox/outbox.service';

const PRODUCER = 'payment-service';

/**
 * Charges an order and emits the outcome.
 *
 * The "gateway" here is simulated deterministically so the demo is reproducible:
 * an order whose total (in cents) ends in DECLINE_WHEN_CENTS_ENDS_IN is declined,
 * everything else succeeds. A real implementation would call Stripe/Adyen — and
 * crucially would pass an idempotency key derived from `orderId` so a retried
 * charge never bills twice at the provider either.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly declineEndsIn: number;

  constructor(
    config: ConfigService,
    private readonly outbox: OutboxService,
  ) {
    this.declineEndsIn = config.get<number>('declineWhenCentsEndsIn')!;
  }

  /**
   * Process a charge for an order. Runs inside the consumer's dedup transaction
   * (`tx`), so the payment row + the outcome event commit atomically with the
   * ProcessedEvent marker.
   */
  async charge(tx: Prisma.TransactionClient, order: OrderCreatedPayload, correlationId: string): Promise<void> {
    const declined = order.totalAmountCents % 100 === this.declineEndsIn;

    if (declined) {
      await tx.payment.create({
        data: {
          orderId: order.orderId,
          customerId: order.customerId,
          amountCents: order.totalAmountCents,
          status: 'FAILED',
          failureCode: 'CARD_DECLINED',
        },
      });
      const payload: PaymentFailedPayload = {
        orderId: order.orderId,
        customerId: order.customerId,
        reason: 'CARD_DECLINED',
      };
      await this.outbox.enqueue(
        tx,
        Topics.PAYMENTS_FAILED,
        createEvent({
          eventType: Topics.PAYMENTS_FAILED,
          correlationId,
          aggregateId: order.orderId,
          producer: PRODUCER,
          payload,
        }),
      );
      this.logger.log(`Payment DECLINED for order ${order.orderId}`);
      return;
    }

    const payment = await tx.payment.create({
      data: {
        orderId: order.orderId,
        customerId: order.customerId,
        amountCents: order.totalAmountCents,
        status: 'COMPLETED',
      },
    });
    const payload: PaymentCompletedPayload = {
      orderId: order.orderId,
      customerId: order.customerId,
      paymentId: payment.id,
      amountChargedCents: order.totalAmountCents,
    };
    await this.outbox.enqueue(
      tx,
      Topics.PAYMENTS_COMPLETED,
      createEvent({
        eventType: Topics.PAYMENTS_COMPLETED,
        correlationId,
        aggregateId: order.orderId,
        producer: PRODUCER,
        payload,
      }),
    );
    this.logger.log(`Payment COMPLETED for order ${order.orderId} (${order.totalAmountCents} cents)`);
  }
}
