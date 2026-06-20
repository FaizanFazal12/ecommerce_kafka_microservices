/**
 * The single source of truth for every Kafka topic in the platform.
 *
 * Every service imports these constants instead of hard-coding strings, so a
 * typo can never silently route a message to a topic nobody consumes.
 *
 * Naming convention: `<aggregate>.<event-in-past-tense>`
 * Events are FACTS about something that already happened — past tense, immutable.
 */
export const Topics = {
  // Order aggregate
  ORDERS_CREATED: 'orders.created',
  ORDERS_CONFIRMED: 'orders.confirmed',
  ORDERS_CANCELLED: 'orders.cancelled',

  // Payment aggregate
  PAYMENTS_COMPLETED: 'payments.completed',
  PAYMENTS_FAILED: 'payments.failed',

  // Inventory aggregate
  INVENTORY_RESERVED: 'inventory.reserved',
  INVENTORY_REJECTED: 'inventory.rejected',
} as const;

/** Dead-letter topics — poison messages land here after retries are exhausted. */
export const DlqTopics = {
  ORDERS_DLQ: 'orders.DLQ',
  PAYMENTS_DLQ: 'payments.DLQ',
  INVENTORY_DLQ: 'inventory.DLQ',
} as const;

export type Topic = (typeof Topics)[keyof typeof Topics];
export type DlqTopic = (typeof DlqTopics)[keyof typeof DlqTopics];
