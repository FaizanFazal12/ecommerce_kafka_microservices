import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EventEnvelope } from '@ecommerce/shared';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Layer 3 — the consumer-side dedup primitive.
 *
 * Runs `work` for an event AT MOST ONCE per (eventId, consumer), even if Kafka
 * redelivers. The trick is doing the dedup insert and the work in the SAME
 * transaction:
 *
 *   - INSERT the eventId into processed_events; if it already exists, the unique
 *     constraint throws P2002 -> we know it's a duplicate and skip the work.
 *   - otherwise run the work; both the marker and the work commit together.
 *
 * If `work` throws, the whole transaction rolls back (including the marker), so
 * the event is NOT recorded as processed and Kafka will redeliver it — exactly
 * what we want for a transient failure.
 */
export async function processOnce(
  prisma: PrismaService,
  consumer: string,
  event: EventEnvelope,
  logger: Logger,
  work: (tx: Prisma.TransactionClient) => Promise<void>,
): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      await tx.processedEvent.create({
        data: { eventId: event.eventId, consumer },
      });
      await work(tx);
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      // Already processed by this consumer — redelivery, safe no-op.
      logger.debug(`Skipping duplicate event ${event.eventId} for ${consumer}`);
      return;
    }
    throw err; // real error -> rollback -> Kafka redelivers
  }
}
