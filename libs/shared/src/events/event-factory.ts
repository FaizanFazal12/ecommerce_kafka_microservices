import { randomUUID } from 'node:crypto';
import { EventEnvelope, NewEvent } from './envelope';

/**
 * Builds a complete, well-formed event envelope from the minimal fields a
 * producer needs to supply. Centralising this guarantees every event in the
 * system has a unique `eventId` and a consistent shape.
 *
 *   const event = createEvent({
 *     eventType: Topics.ORDERS_CREATED,
 *     correlationId,
 *     aggregateId: orderId,
 *     producer: 'order-service',
 *     payload: { orderId, customerId, items, ... },
 *   });
 */
export function createEvent<TType extends string, TPayload>(
  input: NewEvent<TType, TPayload>,
  options?: { version?: number; occurredAt?: string; eventId?: string },
): EventEnvelope<TType, TPayload> {
  return {
    eventId: options?.eventId ?? randomUUID(),
    eventType: input.eventType,
    version: options?.version ?? 1,
    occurredAt: options?.occurredAt ?? new Date().toISOString(),
    correlationId: input.correlationId,
    aggregateId: input.aggregateId,
    producer: input.producer,
    payload: input.payload,
  };
}
