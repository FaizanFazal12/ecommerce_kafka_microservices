import { EventEnvelope } from './envelope';
import { Topics } from './topics';

/** Emitted by Payment Service after a successful charge. */
export interface PaymentCompletedPayload {
  orderId: string;
  customerId: string;
  paymentId: string;
  amountChargedCents: number;
}
export type PaymentCompletedEvent = EventEnvelope<typeof Topics.PAYMENTS_COMPLETED, PaymentCompletedPayload>;

/** Emitted when a charge is declined or errors out. Triggers order cancellation. */
export interface PaymentFailedPayload {
  orderId: string;
  customerId: string;
  reason: 'CARD_DECLINED' | 'INSUFFICIENT_FUNDS' | 'GATEWAY_ERROR';
}
export type PaymentFailedEvent = EventEnvelope<typeof Topics.PAYMENTS_FAILED, PaymentFailedPayload>;
