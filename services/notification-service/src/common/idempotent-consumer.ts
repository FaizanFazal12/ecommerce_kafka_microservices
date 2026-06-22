import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EventEnvelope } from '@ecommerce/shared';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Layer 3 — consumer dedup. Runs `work` at most once per (eventId, consumer).
 * The dedup marker and the work commit in ONE transaction, so a crash rolls back
 * both and Kafka redelivers. A duplicate insert (P2002) means already-processed.
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
      await tx.processedEvent.create({ data: { eventId: event.eventId, consumer } });
      await work(tx);
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      logger.debug(`Skipping duplicate event ${event.eventId} for ${consumer}`);
      return;
    }
    throw err;
  }
}
