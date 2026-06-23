import { Injectable } from '@nestjs/common';
import { Prisma } from '../prisma/client';
import { EventEnvelope } from '@ecommerce/shared';

/** Write side of the outbox (Layer 2). Stage an event inside the caller's tx. */
@Injectable()
export class OutboxService {
  async enqueue(
    tx: Prisma.TransactionClient,
    topic: string,
    event: EventEnvelope,
  ): Promise<void> {
    await tx.outboxEvent.create({
      data: {
        aggregateType: 'Payment',
        aggregateId: event.aggregateId,
        topic,
        partitionKey: event.aggregateId,
        eventType: event.eventType,
        payload: event as unknown as Prisma.InputJsonValue,
      },
    });
  }
}
