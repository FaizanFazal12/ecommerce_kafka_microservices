import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../prisma/client';
import { OrderConfirmedPayload, PaymentFailedPayload } from '@ecommerce/shared';

/**
 * "Sends" notifications. Here that means writing a Notification row and logging —
 * in production this would call an email/SMS/push provider (ideally with its own
 * idempotency key so a retry can't send twice at the provider either).
 *
 * Each method runs inside the consumer's dedup transaction (`tx`), so the
 * Notification row commits atomically with the ProcessedEvent marker.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  async sendOrderConfirmed(tx: Prisma.TransactionClient, order: OrderConfirmedPayload): Promise<void> {
    const body = `Your order ${order.orderId} is confirmed. We charged ${this.fmt(
      order.totalAmountCents,
    )}. Thank you!`;
    await tx.notification.create({
      data: {
        orderId: order.orderId,
        customerId: order.customerId,
        kind: 'ORDER_CONFIRMED',
        body,
      },
    });
    this.logger.log(`📧  -> customer ${order.customerId}: ${body}`);
  }

  async sendPaymentFailed(tx: Prisma.TransactionClient, failure: PaymentFailedPayload): Promise<void> {
    const body = `We couldn't process payment for order ${failure.orderId} (${failure.reason}). Please update your payment method.`;
    await tx.notification.create({
      data: {
        orderId: failure.orderId,
        customerId: failure.customerId,
        kind: 'PAYMENT_FAILED',
        body,
      },
    });
    this.logger.log(`📧  -> customer ${failure.customerId}: ${body}`);
  }

  private fmt(cents: number): string {
    return `$${(cents / 100).toFixed(2)}`;
  }
}
