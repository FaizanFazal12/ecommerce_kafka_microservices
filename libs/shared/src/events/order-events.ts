import { EventEnvelope } from './envelope';
import { Topics } from './topics';

/** A single line in an order. */
export interface OrderLineItem {
  productId: string;
  quantity: number;
  unitPriceCents: number;
}

/** Emitted by Order Service when a new order is persisted (via the outbox). */
export interface OrderCreatedPayload {
  orderId: string;
  customerId: string;
  items: OrderLineItem[];
  totalAmountCents: number;
  currency: string;
}
export type OrderCreatedEvent = EventEnvelope<typeof Topics.ORDERS_CREATED, OrderCreatedPayload>;

/** Emitted when BOTH payment + inventory succeeded — the order is final. */
export interface OrderConfirmedPayload {
  orderId: string;
  customerId: string;
  totalAmountCents: number;
}
export type OrderConfirmedEvent = EventEnvelope<typeof Topics.ORDERS_CONFIRMED, OrderConfirmedPayload>;

/** Emitted when the saga fails (e.g. payment declined) — triggers compensations. */
export interface OrderCancelledPayload {
  orderId: string;
  customerId: string;
  reason: 'PAYMENT_FAILED' | 'OUT_OF_STOCK' | 'CUSTOMER_CANCELLED';
}
export type OrderCancelledEvent = EventEnvelope<typeof Topics.ORDERS_CANCELLED, OrderCancelledPayload>;
