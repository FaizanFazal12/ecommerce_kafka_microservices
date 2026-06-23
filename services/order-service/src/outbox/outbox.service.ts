import { Injectable } from '@nestjs/common';
import { Prisma } from '../prisma/client';
import { EventEnvelope } from '@ecommerce/shared';

/**
 * Helper for the WRITE side of the outbox (Layer 2).
 *
 * `enqueue` takes a Prisma transaction client (`tx`) — NOT the global client —
 * so the outbox row is written inside the SAME transaction as the business
 * state change. That atomicity is the entire point of the pattern: the event
 * and the state commit together or not at all.
 *
 * Publishing the row to Kafka is a separate concern handled by OutboxRelayService.
 */
@Injectable()
export class OutboxService {
  /**
   * Stage an event for publication within the caller's transaction.
   *
   *   await prisma.$transaction(async (tx) => {
   *     await tx.order.create({ ... });
   *     await outbox.enqueue(tx, topic, event);   // same tx -> atomic
   *   });
   */
  async enqueue(
    tx: Prisma.TransactionClient,
    topic: string,
    event: EventEnvelope,
  ): Promise<void> {
    await tx.outboxEvent.create({
      data: {
        aggregateType: 'Order',
        aggregateId: event.aggregateId,
        topic,
        partitionKey: event.aggregateId, // per-order ordering
        eventType: event.eventType,
        payload: event as unknown as Prisma.InputJsonValue,
      },
    });
  }
}
