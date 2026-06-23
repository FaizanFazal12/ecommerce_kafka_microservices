import { DlqTopics, DlqTopic } from './topics';

/**
 * Maps a business topic to the dead-letter topic that should receive its poison
 * messages, by aggregate prefix. A message that fails processing after all
 * retries is parked here for inspection / manual replay, keyed by aggregate so
 * the partition isn't blocked.
 */
export function dlqForTopic(topic: string): DlqTopic {
  if (topic.startsWith('orders.')) return DlqTopics.ORDERS_DLQ;
  if (topic.startsWith('payments.')) return DlqTopics.PAYMENTS_DLQ;
  if (topic.startsWith('inventory.')) return DlqTopics.INVENTORY_DLQ;
  // Unknown source — default bucket so nothing is silently dropped.
  return DlqTopics.ORDERS_DLQ;
}

/**
 * What we publish to a DLQ topic. Wraps the original message plus enough context
 * to diagnose and replay it: which consumer failed, how many attempts, the error,
 * and the raw original event.
 */
export interface DeadLetterEnvelope {
  originalTopic: string;
  consumerGroup: string;
  failedAt: string;
  attempts: number;
  error: { name?: string; message: string };
  /** The original Kafka message key (= aggregate id), if any. */
  key: string | null;
  /** The original event payload (parsed envelope if we could parse it, else raw string). */
  original: unknown;
}
