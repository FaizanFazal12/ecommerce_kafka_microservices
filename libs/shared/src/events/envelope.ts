/**
 * Every event published to Kafka is wrapped in this envelope.
 *
 * The envelope carries the metadata that makes the platform reliable and
 * observable; the service-specific data lives in `payload`.
 *
 * The two most important fields:
 *
 *   - `eventId`       Globally unique id for THIS event instance. Consumers use
 *                     it for deduplication (the `processed_events` table). If the
 *                     same event is redelivered, the id is identical -> no-op.
 *
 *   - `correlationId` Ties together every event produced across the whole saga
 *                     for one user action. Propagated end-to-end so you can trace
 *                     a single checkout through every service in the logs.
 */
export interface EventEnvelope<TType extends string = string, TPayload = unknown> {
  /** Unique id of this event instance (UUID). Primary dedup key for consumers. */
  eventId: string;

  /** Discriminator, e.g. "orders.created". Matches the topic name. */
  eventType: TType;

  /** Schema version of the payload — lets payloads evolve without breaking consumers. */
  version: number;

  /** ISO-8601 timestamp of when the event occurred (not when it was delivered). */
  occurredAt: string;

  /** Shared id across all events of one business transaction (the saga). For tracing. */
  correlationId: string;

  /** The aggregate id this event is about, e.g. the order id. Also used as the Kafka partition key. */
  aggregateId: string;

  /** Service that produced the event, e.g. "order-service". For provenance/debugging. */
  producer: string;

  /** The actual business data. Strongly typed per event. */
  payload: TPayload;
}

/**
 * Helper signature for constructing an envelope. `eventId`, `occurredAt`, and
 * `version` are filled in by the factory so call sites stay terse.
 */
export type NewEvent<TType extends string, TPayload> = Pick<
  EventEnvelope<TType, TPayload>,
  'eventType' | 'correlationId' | 'aggregateId' | 'producer' | 'payload'
>;
