import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '../prisma/client';
import {
  createEvent,
  Topics,
  OrderCreatedPayload,
  OrderCancelledPayload,
  InventoryReservedPayload,
  InventoryRejectedPayload,
} from '@ecommerce/shared';
import { OutboxService } from '../outbox/outbox.service';

const PRODUCER = 'inventory-service';

interface ReservedItem {
  productId: string;
  quantity: number;
}

/**
 * Reserves and releases stock.
 *
 * Both operations run inside the consumer's dedup transaction (`tx`), so stock
 * changes + the reservation row + any emitted event commit atomically with the
 * ProcessedEvent marker.
 */
@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);
  private readonly defaultStock: number;

  constructor(
    config: ConfigService,
    private readonly outbox: OutboxService,
  ) {
    this.defaultStock = config.get<number>('defaultStock')!;
  }

  /**
   * Try to reserve stock for every line in the order — all or nothing.
   * Emits inventory.reserved on success, inventory.rejected on any shortfall.
   */
  async reserve(tx: Prisma.TransactionClient, order: OrderCreatedPayload, correlationId: string): Promise<void> {
    // Ensure a Product row exists for each item (unknown products start at defaultStock).
    for (const item of order.items) {
      await tx.product.upsert({
        where: { id: item.productId },
        update: {},
        create: { id: item.productId, availableQty: this.defaultStock, reservedQty: 0 },
      });
    }

    // Check availability for ALL items before mutating anything.
    const shortfalls: InventoryRejectedPayload['shortfalls'] = [];
    for (const item of order.items) {
      const product = await tx.product.findUniqueOrThrow({ where: { id: item.productId } });
      if (product.availableQty < item.quantity) {
        shortfalls.push({
          productId: item.productId,
          requested: item.quantity,
          available: product.availableQty,
        });
      }
    }

    if (shortfalls.length > 0) {
      const payload: InventoryRejectedPayload = {
        orderId: order.orderId,
        reason: 'OUT_OF_STOCK',
        shortfalls,
      };
      await this.outbox.enqueue(
        tx,
        Topics.INVENTORY_REJECTED,
        createEvent({
          eventType: Topics.INVENTORY_REJECTED,
          correlationId,
          aggregateId: order.orderId,
          producer: PRODUCER,
          payload,
        }),
      );
      this.logger.log(`Inventory REJECTED for order ${order.orderId} (${shortfalls.length} shortfall(s))`);
      return;
    }

    // Sufficient stock: move quantity from available -> reserved for each item.
    for (const item of order.items) {
      await tx.product.update({
        where: { id: item.productId },
        data: {
          availableQty: { decrement: item.quantity },
          reservedQty: { increment: item.quantity },
        },
      });
    }

    const reservedItems: ReservedItem[] = order.items.map((i) => ({
      productId: i.productId,
      quantity: i.quantity,
    }));
    const reservation = await tx.reservation.create({
      data: {
        orderId: order.orderId,
        status: 'RESERVED',
        items: reservedItems as unknown as Prisma.InputJsonValue,
      },
    });

    const payload: InventoryReservedPayload = {
      orderId: order.orderId,
      reservationId: reservation.id,
      items: reservedItems,
    };
    await this.outbox.enqueue(
      tx,
      Topics.INVENTORY_RESERVED,
      createEvent({
        eventType: Topics.INVENTORY_RESERVED,
        correlationId,
        aggregateId: order.orderId,
        producer: PRODUCER,
        payload,
      }),
    );
    this.logger.log(`Inventory RESERVED for order ${order.orderId}`);
  }

  /**
   * Compensating action: release a reservation when its order is cancelled.
   * Guarded by the reservation status so a redelivered cancel never double-restores.
   */
  async release(tx: Prisma.TransactionClient, cancelled: OrderCancelledPayload): Promise<void> {
    const reservation = await tx.reservation.findUnique({
      where: { orderId: cancelled.orderId },
    });

    // No reservation (e.g. the cancel was due to OUT_OF_STOCK) or already released.
    if (!reservation || reservation.status !== 'RESERVED') {
      this.logger.debug(`No active reservation to release for order ${cancelled.orderId}`);
      return;
    }

    const items = reservation.items as unknown as ReservedItem[];
    for (const item of items) {
      await tx.product.update({
        where: { id: item.productId },
        data: {
          availableQty: { increment: item.quantity },
          reservedQty: { decrement: item.quantity },
        },
      });
    }

    await tx.reservation.update({
      where: { orderId: cancelled.orderId },
      data: { status: 'RELEASED' },
    });
    this.logger.log(`Inventory RELEASED for order ${cancelled.orderId} (${cancelled.reason})`);
  }
}
